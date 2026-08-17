"""Public leaderboard endpoint."""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_session
from app.models import Submission, SubmissionStatus, TaskSubmission
from app.schemas.leaderboard import LeaderboardRow, LeaderboardScore

router = APIRouter(prefix="/api/leaderboard", tags=["leaderboard"])


@router.get("", response_model=list[LeaderboardRow])
async def leaderboard(session: AsyncSession = Depends(get_session)) -> list[LeaderboardRow]:
    """Return all public, completed submissions for the leaderboard.

    The one endpoint with no notion of a caller: it publishes finished, public work and
    nothing else, so it takes no user and withholds nothing.

    Each row carries per-task primary-metric means so the frontend can build one sortable
    column per task suite.
    """
    result = await session.execute(
        select(Submission)
        .where(Submission.is_public.is_(True), Submission.status == SubmissionStatus.done)
        .options(
            selectinload(Submission.task_submissions).selectinload(TaskSubmission.score),
            selectinload(Submission.team),
            selectinload(Submission.model),
        )
        .order_by(Submission.created_at.desc())
    )

    return [
        LeaderboardRow(
            id=submission.id,
            label=submission.label,
            team_id=submission.team_id,
            team_name=submission.team.name,
            model_id=submission.model_id,
            model_name=submission.model.name,
            created_at=submission.created_at,
            # A task with no score yet contributes no column.
            scores={
                task.task_id: LeaderboardScore.from_score(task.score)
                for task in submission.task_submissions
                if task.score is not None
            },
        )
        for submission in result.scalars().all()
    ]
