"""Public leaderboard endpoint."""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_session
from app.models import Model, Submission, SubmissionStatus, Task, TaskSubmission
from app.ranking import latest_per_model_team, rank_submissions
from app.schemas.leaderboard import LeaderboardRow, LeaderboardScore

router = APIRouter(prefix="/api/leaderboard", tags=["leaderboard"])


@router.get("", response_model=list[LeaderboardRow])
async def leaderboard(
    is_pretrained: bool | None = None,
    session: AsyncSession = Depends(get_session),
) -> list[LeaderboardRow]:
    """Return all public, completed submissions for the leaderboard.

    The one endpoint with no notion of a caller: it publishes finished, public work and
    nothing else, so it takes no user and withholds nothing.

    Each row carries per-task primary-metric means so the frontend can build one sortable
    column per metric group, and the rank it earned on each task.

    ``is_pretrained`` narrows to models that are, or are not, pretrained. It narrows the
    *field*, not just the view: ranks are computed over whatever survives it, so a model's
    position is against the models it is being shown beside. Filtering in the browser would
    leave every rank describing a set no longer on screen, which is why this lives here.

    A model whose ``is_pretrained`` was never filled in matches neither value — the column
    is nullable and an unanswered question is not a "no". Omit the parameter to include them.
    """
    query = (
        select(Submission)
        .where(Submission.is_public.is_(True), Submission.status == SubmissionStatus.done)
        .options(
            selectinload(Submission.task_submissions).selectinload(TaskSubmission.score),
            selectinload(Submission.team),
            selectinload(Submission.model),
        )
        .order_by(Submission.created_at.desc())
    )

    # ``has`` rather than a join: ``Model`` is already being loaded for the row's name, and
    # joining it a second time here would have to be aliased to avoid colliding with that.
    if is_pretrained is not None:
        query = query.where(Submission.model.has(Model.is_pretrained.is_(is_pretrained)))

    submissions = list((await session.execute(query)).scalars().all())

    # Ranked over the contenders rather than over every row: a model's superseded runs would
    # otherwise compete against its current one. They stay in the response — the client is
    # what collapses them — but they carry no rank.
    tasks = (await session.execute(select(Task))).scalars().all()
    ranks = rank_submissions(latest_per_model_team(submissions), tasks)

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
            ranks=ranks.get(str(submission.id), {}),
        )
        for submission in submissions
    ]
