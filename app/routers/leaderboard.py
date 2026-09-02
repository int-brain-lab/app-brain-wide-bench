"""Public leaderboard endpoint."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_session
from app.models import (
    Calibration,
    FinetuningStrategy,
    Modality,
    Model,
    Submission,
    SubmissionStatus,
    SupervisionRegime,
    Task,
    TaskSubmission,
    TrainingParadigm,
)
from app.ranking.filters import matches_entry, matches_model
from app.ranking.rank import rank_standings, standings
from app.schemas.leaderboard import LeaderboardRow, LeaderboardScore

router = APIRouter(prefix="/api/leaderboard", tags=["leaderboard"])


@router.get("", response_model=list[LeaderboardRow])
async def leaderboard(
    is_pretrained: Annotated[list[bool] | None, Query()] = None,
    pretrained_in_modalities: Annotated[list[Modality] | None, Query()] = None,
    pretrained_out_modalities: Annotated[list[Modality] | None, Query()] = None,
    extra_input_modality: Annotated[list[Modality] | None, Query()] = None,
    training_paradigm: Annotated[list[TrainingParadigm] | None, Query()] = None,
    supervision_regime: Annotated[list[SupervisionRegime] | None, Query()] = None,
    calibration: Annotated[list[Calibration] | None, Query()] = None,
    finetuning_strategy: Annotated[list[FinetuningStrategy] | None, Query()] = None,
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
    latest upload — see app/ranking/rank.py.

    Every parameter narrows the *field*, not just the view: ranks are computed over whatever
    survives, so a model's position is against the models it is being shown beside. Filtering
    in the browser would leave every rank describing a set no longer on screen, which is why
    this lives here.

    They narrow at two grains, and the difference matters:

    * ``is_pretrained`` and the two pretraining modality lists are facts about the *model*, so
      they take whole models out of the field.
    * the five methodology parameters are facts about a *task entry*, so they take entries out
      — a model stays on the board carrying only the tasks it did the way the reader asked
      about. Applied before the newest entry per task is chosen, so a model that re-ran a task
      differently stands on the run that matches rather than dropping the task; see
      ``latest_entries``.

    A filter naming several values matches any of them, a list column matches on overlap, and
    a field never filled in matches nothing — an unanswered question is not a "no". See
    app/ranking/filters.py, which is where all three rules live.

    A model left with no surviving entries is dropped rather than returned empty: a row with
    nothing in any column is not a competitor on this board.
    """
    query = (
        select(Submission)
        .where(Submission.is_public.is_(True), Submission.status == SubmissionStatus.done)
        .options(
            selectinload(Submission.task_submissions).selectinload(TaskSubmission.score),
            selectinload(Submission.model).selectinload(Model.team),
        )
    )

    submissions = list((await session.execute(query)).scalars().all())

    # Matched here rather than in the query. Three of the eight are JSONB lists, whose
    # containment operator Postgres has and SQLite — which the tests build their schema on —
    # does not; and the whole public set is loaded regardless, because ranking reads every
    # score's recordings. See app/ranking/filters.py.
    submissions = [
        submission
        for submission in submissions
        if matches_model(
            submission.model,
            is_pretrained=is_pretrained or (),
            pretrained_in_modalities=pretrained_in_modalities or (),
            pretrained_out_modalities=pretrained_out_modalities or (),
        )
    ]

    def keep(entry: TaskSubmission) -> bool:
        return matches_entry(
            entry,
            extra_input_modality=extra_input_modality or (),
            training_paradigm=training_paradigm or (),
            supervision_regime=supervision_regime or (),
            calibration=calibration or (),
            finetuning_strategy=finetuning_strategy or (),
        )

    rows = [standing for standing in standings(submissions, keep) if standing.entries]
    tasks = (await session.execute(select(Task))).scalars().all()
    ranks = rank_standings(rows, tasks)

    return [
        LeaderboardRow(
            id=row.latest.id,
            label=row.latest.label,
            # Off the model, which is where a submission's team lives.
            team_id=row.latest.model.team_id,
            team_name=row.latest.model.team.name,
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
