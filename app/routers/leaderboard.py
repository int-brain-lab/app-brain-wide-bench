"""Public leaderboard endpoint."""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import Submission, SubmissionStatus

router = APIRouter(prefix="/api", tags=["leaderboard"])


@router.get("/leaderboard")
async def leaderboard(session: AsyncSession = Depends(get_session)) -> list[dict]:
    """Return all public, completed submissions for the leaderboard.

    Each row exposes its per-task ``summary`` (primary metric mean) so the frontend
    can build one sortable column per task.
    """
    result = await session.execute(
        select(Submission)
        .where(Submission.is_public.is_(True), Submission.status == SubmissionStatus.done)
        .order_by(Submission.created_at.desc())
    )
    rows = []
    for sub in result.scalars().all():
        summary = (sub.score_results or {}).get("summary", {})
        rows.append(
            {
                "id": str(sub.id),
                "title": sub.title,
                "affiliation": sub.affiliation,
                "task": sub.task.value,
                "created_at": sub.created_at.isoformat(),
                "summary": summary,
            }
        )
    return rows
