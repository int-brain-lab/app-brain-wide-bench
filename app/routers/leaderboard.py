"""Public leaderboard endpoint."""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_session
from app.models import Model, Submission, SubmissionStatus, Task, TaskSubmission
from app.ranking import rank_standings, standings
from app.schemas.leaderboard import LeaderboardRow, LeaderboardScore

router = APIRouter(prefix="/api/leaderboard", tags=["leaderboard"])


@router.get("", response_model=list[LeaderboardRow])
async def leaderboard(
    is_pretrained: bool | None = None,
    session: AsyncSession = Depends(get_session),
) -> list[LeaderboardRow]:
    """Return the standing of every model with public, completed work.

    The one endpoint with no notion of a caller: it publishes finished, public work and
    nothing else, so it takes no user and withholds nothing. Two callers asking the same
    question get the same bytes, which is what keeps it cacheable.

    That is also why it says nothing about whose rows these are. A client marking the
    reader's own intersects ``team_id`` against their own teams itself — one request for
    the board, one for the memberships — rather than making this response per-caller.

    One row per model, carrying its newest score for each task and the rank that score
    earned. The collapse happens here rather than in the client because it is what the
    ranking is computed over: a model competes as where it currently stands, not as its
    latest upload — see app/ranking.py.

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
    )

    # ``has`` rather than a join: ``Model`` is already being loaded for the row's name, and
    # joining it a second time here would have to be aliased to avoid colliding with that.
    if is_pretrained is not None:
        query = query.where(Submission.model.has(Model.is_pretrained.is_(is_pretrained)))

    submissions = list((await session.execute(query)).scalars().all())

    rows = standings(submissions)
    tasks = (await session.execute(select(Task))).scalars().all()
    ranks = rank_standings(rows, tasks)

    return [
        LeaderboardRow(
            id=row.latest.id,
            label=row.latest.label,
            # The team off the newest submission rather than off the standing: whose model
            # this is belongs to the model, and every submission of it agrees.
            team_id=row.latest.team_id,
            team_name=row.latest.team.name,
            model_id=row.model_id,
            model_name=row.latest.model.name,
            # Off the already-loaded ``model`` relationship — the same one supplying the
            # name above, so this costs no extra query.
            is_pretrained=row.latest.model.is_pretrained,
            created_at=row.latest.created_at,
            n_submissions=row.n_submissions,
            scores={
                task_id: LeaderboardScore.from_entry(entry)
                for task_id, entry in row.entries.items()
            },
            ranks=ranks.get(row.label, {}),
        )
        for row in rows
    ]
