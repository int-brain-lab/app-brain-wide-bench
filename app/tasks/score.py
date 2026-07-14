"""Celery scoring task — glue only.

Orchestrates S3 I/O and DB writes; all numerical work is delegated to
:func:`app.scoring.get_scorer`.
"""

import asyncio
import tempfile
import uuid
from collections import defaultdict
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import async_session_factory
from app.models import Submission, SubmissionStatus, TaskScore
from app.scoring import get_scorer
from app.storage import download_ground_truth, download_submission
from app.worker import celery_app


async def _start_scoring(
    submission_id: uuid.UUID,
) -> tuple[str, list[tuple[uuid.UUID, str]]]:
    """Set status to ``scoring``; return ``(s3_key, [(task_submission_id, task_id)])``.

    Returns the task-submission list so the Celery task can pass it to
    :func:`_finish_scoring` without re-querying the DB.
    """
    async with async_session_factory() as session:
        submission = (
            await session.execute(
                select(Submission)
                .options(selectinload(Submission.task_submissions))
                .where(Submission.id == submission_id)
            )
        ).scalar_one()
        submission.status = SubmissionStatus.scoring
        ts_list = [(ts.id, ts.task_id) for ts in submission.task_submissions]
        s3_key = submission.s3_key
        await session.commit()
    return s3_key, ts_list


async def _finish_scoring(
    submission_id: uuid.UUID,
    status: SubmissionStatus,
    ts_list: list[tuple[uuid.UUID, str]],
    results: dict | None = None,
) -> None:
    """Persist final status and, on success, write one :class:`TaskScore` per task."""
    async with async_session_factory() as session:
        submission = (
            await session.execute(select(Submission).where(Submission.id == submission_id))
        ).scalar_one()
        submission.status = status

        if results and "summary" in results:
            summary = results["summary"]
            rows_by_task: dict[str, list] = defaultdict(list)
            for row in results.get("rows", []):
                rows_by_task[row["task"]].append(row)

            for ts_id, task_id in ts_list:
                if task_id not in summary:
                    continue
                s = summary[task_id]
                session.add(
                    TaskScore(
                        task_submission_id=ts_id,
                        n_seeds=s["n"],
                        primary_metric_mean=s["mean"],
                        primary_metric_sem=s.get("sem"),
                        metrics={"recordings": rows_by_task.get(task_id, [])},
                    )
                )

        await session.commit()


@celery_app.task(name="score_submission")
def score_submission(submission_id: str) -> str:
    """Score a submission end to end and persist per-task results.

    Parameters
    ----------
    submission_id : str
        UUID of the submission to score.

    Returns
    -------
    str
        Final status (``"done"`` or ``"failed"``).
    """
    sid = uuid.UUID(submission_id)
    s3_key, ts_list = asyncio.run(_start_scoring(sid))

    if not ts_list:
        asyncio.run(_finish_scoring(sid, SubmissionStatus.failed, ts_list))
        return "failed"

    # Derive suite from first task id, e.g. "ts1-reward" → "ts1"
    suite = ts_list[0][1].split("-")[0]

    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)
        try:
            zip_path = download_submission(s3_key, tmpdir.joinpath("submission.zip"))
            gt_dir = download_ground_truth(suite, tmpdir.joinpath("gt"))
            scorer = get_scorer(suite)
            pred_dir = scorer.extract(zip_path, tmpdir.joinpath("pred"))
            results = scorer.score(pred_dir, gt_dir)
            asyncio.run(_finish_scoring(sid, SubmissionStatus.done, ts_list, results))
            return "done"
        except Exception as exc:  # noqa: BLE001 — surface any failure in the DB for the user
            asyncio.run(_finish_scoring(sid, SubmissionStatus.failed, ts_list))
            raise exc