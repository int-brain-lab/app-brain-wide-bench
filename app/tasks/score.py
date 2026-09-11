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
from app.scoring import BaseScorer, get_scorer
from app.storage import download_ground_truth, download_submission
from app.worker import celery_app


async def _start_scoring(
    submission_id: uuid.UUID,
) -> tuple[str, list[tuple[uuid.UUID, str]]] | None:
    """Set status to ``scoring``; return ``(s3_key, [(task_submission_id, task_id)])``.

    Returns the task-submission list so the Celery task can pass it to
    :func:`_finish_scoring` without re-querying the DB.

    ``None`` when the submission is gone: a delete racing this task is a submitter
    abandoning their submission, and the outcome they asked for is that nothing is scored.
    """
    async with async_session_factory() as session:
        submission = (
            await session.execute(
                select(Submission)
                .options(selectinload(Submission.task_submissions))
                .where(Submission.id == submission_id)
            )
        ).scalar_one_or_none()

        if submission is None:
            return None

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
) -> bool:
    """Persist final status and, on success, write one :class:`TaskScore` per task.

    ``False`` when the submission is gone, as :func:`_start_scoring` returns ``None``: the
    task rows the scores would hang off went with it.
    """
    async with async_session_factory() as session:
        submission = (
            await session.execute(select(Submission).where(Submission.id == submission_id))
        ).scalar_one_or_none()

        if submission is None:
            return False

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

    return True


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
        Final status (``"done"`` or ``"failed"``), or ``"gone"`` when the submission was
        deleted before or during the run.
    """
    sid = uuid.UUID(submission_id)
    started = asyncio.run(_start_scoring(sid))

    if started is None:
        return "gone"

    s3_key, ts_list = started

    if not ts_list:
        asyncio.run(_finish_scoring(sid, SubmissionStatus.failed, ts_list))
        return "failed"

    # A submission may span suites. Each scorer skips prediction files that are not its own,
    # so every suite present has to be run for its tasks to be scored at all.
    suites = sorted({task_id.split("-")[0] for _, task_id in ts_list})

    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)
        try:
            zip_path = download_submission(s3_key, tmpdir.joinpath("submission.zip"))

            gt_dir = download_ground_truth(suites, tmpdir.joinpath("gt"))

            pred_dir = BaseScorer.extract(zip_path, tmpdir.joinpath("pred"))

            # summary is keyed by flat task id, which is unique across suites, so merging
            # cannot collide; rows carry their own task.
            results: dict = {"rows": [], "summary": {}}
            for suite in suites:
                scored = get_scorer(suite).score(pred_dir, gt_dir)
                results["rows"].extend(scored["rows"])
                results["summary"].update(scored["summary"])

            if not asyncio.run(_finish_scoring(sid, SubmissionStatus.done, ts_list, results)):
                return "gone"

            return "done"
        except Exception as exc:  # noqa: BLE001 — surface any failure in the DB for the user
            # A submission deleted mid-run is the likeliest cause of landing here, and there
            # is no row left to record the failure on.
            if not asyncio.run(_finish_scoring(sid, SubmissionStatus.failed, ts_list)):
                return "gone"

            raise exc
