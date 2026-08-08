"""Model card endpoint: metadata plus visibility-scoped submissions."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from typing import Any

from app.auth import (
    get_current_user,
    get_current_user_optional,
    is_team_member,
    member_team_ids,
    require_team_member,
)
from app.database import get_session
from app.models import (
    Model,
    Submission,
    Task,
    TaskScore,
    TaskSubmission,
    TaskSuite,
    User,
)
from app.schemas.models import (
    ModelCreate,
    ModelDetail,
    ModelList,
    ModelUpdate,
)

router = APIRouter(prefix="/api/models", tags=["models"])


# ── Per-model aggregates ──────────────────────────────────────────────────────
#
# ``ModelList`` advertises how many submissions a model has and which task suites it
# has results for. Computed in SQL rather than by walking ``Model.submissions``: the
# suite lookup needs submissions → task_submissions → task → score, and eagerly
# loading that whole tree per model to produce a count and a few enum values is a lot
# of rows for two small fields.
#
# ``model_stats`` is shared with ``GET /api/users/me/models`` (app/routers/users.py).

# Suites are reported in enum declaration order, not the order rows come back in, so
# the badges line up down a table column.
_SUITE_ORDER = {suite: index for index, suite in enumerate(TaskSuite)}


async def model_stats(
    session: AsyncSession, visible: ColumnElement[bool]
) -> tuple[dict[uuid.UUID, int], dict[uuid.UUID, list[TaskSuite]]]:
    """Return ``(counts, suites)`` keyed by model id, over the submissions matching ``visible``.

    Two statements rather than one join: combining a COUNT with a many-valued suite
    join would multiply the count by the number of suite rows.

    Plain dicts, so a model with no submissions is simply absent and callers use
    ``.get(id, default)`` rather than needing a row per model.
    """
    # Every status counts: a `failed` run still happened, and excluding it would make
    # the number disagree with the submissions list shown beside it.
    count_rows = await session.execute(
        select(Submission.model_id, func.count(Submission.id))
        .where(visible)
        .group_by(Submission.model_id)
    )
    counts = dict(count_rows.all())

    # Joined through TaskScore, so a suite only counts once it has a result — a
    # pending or failed task contributes nothing. A badge for a suite with no score
    # next to it reads as missing data rather than as work in progress.
    #
    # `Task.task_suite` is authoritative, rather than the "ts1-" prefix on `task_id`
    # that the frontend parses for display.
    suite_rows = await session.execute(
        select(Submission.model_id, Task.task_suite)
        .join(TaskSubmission, TaskSubmission.submission_id == Submission.id)
        .join(Task, Task.id == TaskSubmission.task_id)
        .join(TaskScore, TaskScore.task_submission_id == TaskSubmission.id)
        .where(visible)
        .distinct()
    )

    suites: dict[uuid.UUID, list[TaskSuite]] = {}
    for model_id, suite in suite_rows.all():
        suites.setdefault(model_id, []).append(suite)

    for model_suites in suites.values():
        model_suites.sort(key=lambda suite: _SUITE_ORDER[suite])

    return counts, suites


async def _get_model_or_404(
    session: AsyncSession,
    model_id: uuid.UUID,
    *options: Any
) -> Model:
    """Fetch a model by id, applying any loader ``options``

    Raises: 404 - Not found if the model doesn't exist
    """
    model = (
        await session.execute(
            select(Model).options(*options)
            .where(Model.id == model_id)
        )
    ).scalar_one_or_none()
    if model is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Model not found")
    return model




async def _load_model_detail(
    session: AsyncSession, model_id: uuid.UUID, user: User | None
) -> ModelDetail:
    """Return a model's details: metadata, team name, and visibility-scoped submissions.

    Anonymous viewers and non-team members see only public submissions; a
    member of the model's team sees all of them, public or private.
    """
    model = await _get_model_or_404(
        session,
        model_id,
        selectinload(Model.team),
        selectinload(Model.submissions)
        .selectinload(Submission.task_submissions)
        .selectinload(TaskSubmission.score)
    )

    submissions: list[Submission]
    if user is not None and await is_team_member(session, user.id, model.team_id):
        submissions = model.submissions
    else:
        submissions = [s for s in model.submissions if s.is_public]

    return ModelDetail.from_model(model, submissions=submissions)


@router.get("", response_model=list[ModelList])
async def list_models(
    user: User | None = Depends(get_current_user_optional),
    session: AsyncSession = Depends(get_session),
) -> list[ModelList]:
    """List models with a public result, plus the caller's own models. Newest first.

    Anonymous callers see only models with at least one public submission — a
    model whose work is all private, or which has no submissions yet, is not
    listed at all.

    An authenticated caller additionally sees every model on a team they belong
    to, whether or not it has a public submission.
    """
    has_public_submission = (
        select(Submission.id)
        .where(Submission.model_id == Model.id, Submission.is_public.is_(True))
        .exists()
    )
    my_team_ids = await member_team_ids(session, user.id if user else None)

    # Which models to list.
    visible = (
        or_(has_public_submission, Model.team_id.in_(list(my_team_ids)))
        if my_team_ids
        else has_public_submission
    )

    # Which of their submissions may be counted — a separate question from `visible`
    # above, though built from the same team ids. `visible` admits a model on the
    # strength of one public result; that must not license reporting the private ones
    # behind it, or the count and the badges leak unpublished work.
    countable = (
        or_(
            Submission.is_public.is_(True),
            Submission.model_id.in_(
                select(Model.id).where(Model.team_id.in_(list(my_team_ids)))
            ),
        )
        if my_team_ids
        else Submission.is_public.is_(True)
    )

    models = (
        (
            await session.execute(
                select(Model)
                .options(selectinload(Model.team))
                .where(visible)
                .order_by(Model.created_at.desc())
            )
        )
        .scalars()
        .all()
    )

    counts, suites = await model_stats(session, countable)

    return [
        ModelList.from_model(
            model,
            n_submissions=counts.get(model.id, 0),
            task_suites=suites.get(model.id, []),
        )
        for model in models
    ]


@router.post("", response_model=ModelDetail, status_code=status.HTTP_201_CREATED)
async def create_model(
    body: ModelCreate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ModelDetail:
    """Create a new model. Requires membership of the team it is assigned to."""
    await require_team_member(session, user.id, body.team_id)

    # `Model.id` comes from a default_factory, so it's populated at construction —
    # no flush needed to read it, and the session is created with
    # expire_on_commit=False so it survives the commit.
    model = Model(**body.model_dump())
    session.add(model)
    await session.commit()

    return await _load_model_detail(session, model.id, user)


@router.get("/{model_id}", response_model=ModelDetail)
async def get_model(
    model_id: uuid.UUID,
    user: User | None = Depends(get_current_user_optional),
    session: AsyncSession = Depends(get_session),
) -> ModelDetail:
    """Return a model's details: metadata, team name, and its submissions."""
    return await _load_model_detail(session, model_id, user)


@router.patch("/{model_id}", response_model=ModelDetail)
async def update_model(
    model_id: uuid.UUID,
    body: ModelUpdate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ModelDetail:
    """Update a model's metadata, or reassign it to a different team.

    Requires membership of the model's current team; reassignment additionally
    requires membership of the target team.
    """
    model = await _get_model_or_404(session, model_id)
    await require_team_member(
        session, user.id, model.team_id, detail="Not a member of this model's team"
    )

    updates = body.model_dump(exclude_unset=True)

    # Reassignment is handled separately because it needs its own permission check.
    new_team_id = updates.pop("team_id", None)
    if new_team_id is not None and new_team_id != model.team_id:
        await require_team_member(
            session, user.id, new_team_id, detail="Not a member of the target team"
        )
        model.team_id = new_team_id

    for field, value in updates.items():
        setattr(model, field, value)

    await session.commit()
    return await _load_model_detail(session, model_id, user)