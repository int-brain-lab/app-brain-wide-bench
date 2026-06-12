"""Celery scoring task — glue only.

Orchestrates S3 I/O and DB writes; all numerical work is delegated to
:func:`app.scoring.get_scorer`.
"""

import asyncio
import tempfile
from pathlib import Path
from uuid import UUID

from sqlalchemy import select

from app.database import async_session_factory
from app.models import Submission, SubmissionStatus
from app.scoring import get_scorer
from app.storage import download_ground_truth, download_submission
from app.worker import celery_app


async def _set_status(
    submission_id: UUID, status: SubmissionStatus, results: dict | None = None
) -> tuple[str, str]:
    """Update a submission's status (and optionally results); return ``(task, s3_key)``."""
    async with async_session_factory() as session:
        submission = (
            await session.execute(select(Submission).where(Submission.id == submission_id))
        ).scalar_one()
        submission.status = status
        if results is not None:
            submission.score_results = results
        task = submission.task.value
        s3_key = submission.s3_key
        await session.commit()
    return task, s3_key


@celery_app.task(name="score_submission")
def score_submission(submission_id: str) -> str:
    """Score a submission end to end and persist the result.

    Parameters
    ----------
    submission_id : str
        UUID of the submission to score.

    Returns
    -------
    str
        Final status (``"done"`` or ``"failed"``).
    """
    sid = UUID(submission_id)
    task, s3_key = asyncio.run(_set_status(sid, SubmissionStatus.scoring))

    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)
        try:
            zip_path = download_submission(s3_key, tmpdir.joinpath("submission.zip"))
            gt_dir = download_ground_truth(task, tmpdir.joinpath("gt"))

            scorer = get_scorer(task)
            pred_dir = scorer.extract(zip_path, tmpdir.joinpath("pred"))
            results = scorer.score(pred_dir, gt_dir)

            asyncio.run(_set_status(sid, SubmissionStatus.done, results))
            return "done"
        except Exception as exc:  # noqa: BLE001 — record any failure for the user
            asyncio.run(_set_status(sid, SubmissionStatus.failed, {"error": str(exc)}))
            return "failed"
