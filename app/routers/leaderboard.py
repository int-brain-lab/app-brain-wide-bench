"""Public leaderboard endpoint."""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_session
from app.models import Submission, SubmissionStatus, TaskSubmission

router = APIRouter(prefix="/api", tags=["leaderboard"])


@router.get("/leaderboard")
async def leaderboard(session: AsyncSession = Depends(get_session)) -> list[dict]:
    """Return all public, completed submissions for the leaderboard.

    Each row includes per-task primary-metric means so the frontend can build
    one sortable column per task.
    """
    result = await session.execute(
        select(Submission)
        .where(Submission.is_public.is_(True), Submission.status == SubmissionStatus.done)
        .options(
            selectinload(Submission.task_submissions).selectinload(TaskSubmission.score)
        )
        .order_by(Submission.created_at.desc())
    )
    rows = []
    for sub in result.scalars().all():
        scores = {
            ts.task_id: {
                "primary_metric_mean": ts.score.primary_metric_mean,
                "primary_metric_sem": ts.score.primary_metric_sem,
                "n_seeds": ts.score.n_seeds,
            }
            for ts in sub.task_submissions
            if ts.score is not None
        }
        rows.append(
            {
                "id": str(sub.id),
                "label": sub.label,
                "team_id": str(sub.team_id),
                "model_id": str(sub.model_id),
                "created_at": sub.created_at.isoformat(),
                "scores": scores,
            }
        )
    return rows
