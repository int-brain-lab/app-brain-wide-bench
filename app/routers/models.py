"""Model endpoint"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from typing import Annotated, Any, Sequence

from app.auth import (
    get_current_user,
    get_current_user_optional,
    is_team_member,
    member_team_ids,
    require_team_member,
)
from app.database import get_session
from app.ranking.rank import Standing, latest_entries, place_standings, standings
from app.routers.submissions import visible_submissions
from app.models import (
    Model,
    Submission,
    SubmissionStatus,
    Task,
    TaskScore,
    TaskSubmission,
    TaskSuite,
    User,
)
from app.schemas.models import (
    ModelBreakdown,
    ModelCreate,
    ModelDetail,
    ModelRanking,
    ModelResponse,
    ModelUpdate,
    RankingSide,
    TaskEntryRef,
    TaskEntrySides,
)
from app.schemas.tasksubmission import TaskBreakdown

router = APIRouter(prefix="/api/models", tags=["models"])


# ── Per-model aggregates ──────────────────────────────────────────────────────
async def visible_models(
    user: User | None,
    session: AsyncSession,
) -> ColumnElement[bool]:
    """Return a SQLAlchemy expression that evaluates to True for models visible to the user."""

    has_public_submission = (
        select(Submission.id)
        .where(Submission.model_id == Model.id, Submission.is_public.is_(True))
        .exists()
    )

    if user is None:
        return has_public_submission

    my_team_ids = await member_team_ids(user.id, session)

    visible = or_(has_public_submission, Model.team_id.in_(list(my_team_ids)))

    return visible


async def submission_count_per_model(
    visible: ColumnElement[bool],
    session: AsyncSession,
) -> dict[uuid.UUID, int]:
    """Return the number of submissions per model.

    Returns a dict of {modelId: nSubmissions}.

    Only submissions that match the ``visible`` criteria are considered.
    """

    count_rows = await session.execute(
        select(Submission.model_id, func.count(Submission.id))
        .where(visible)
        .group_by(Submission.model_id)
    )
    return dict(count_rows.all())


async def suites_per_model(
    visible: ColumnElement[bool],
    session: AsyncSession,
) -> dict[uuid.UUID, list[TaskSuite]]:
    """Return the task suites per model.

    Returns a dict of {modelId: [TaskSuite]}.

    Only submissions that match the ``visible`` criteria are considered.
    """
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

    return suites


# ── Helper functions ──────────────────────────────────────────────────────


async def _get_model(
    model_id: uuid.UUID,
    session: AsyncSession,
    *,
    options: Sequence[Any] = (),
) -> Model:
    """Fetch a model by ``model_id``, applying any loader ``options``.

    Raises: 404 - Not found if the model doesn't exist
    """
    model = (
        await session.execute(
            select(Model)
            .options(*options)
            .where(Model.id == model_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if model is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Model not found")
    return model


async def _check_valid_model_name(
    name: str,
    team_id: uuid.UUID,
    session: AsyncSession,
    *,
    exclude_id: uuid.UUID | None = None,
) -> str:
    """Check a model name is not blank and is unused within ``team_id``. Returns it trimmed.

    Unique per team, not globally: two labs may each have an "mlp-baseline", and a model
    is only ever named in the context of whose it is. Compared case-insensitively, so
    "MLP-Baseline" doesn't read as a second model.

    ``exclude_id`` is the model being updated, so keeping its own name is not a conflict
    with itself. Pass the *destination* team when a PATCH moves it: the name has to be
    free where it is going, not where it has been.

    Raises: 422 - Unprocessable Content if the name is blank
    Raises: 409 - Conflict if the team already has a model with that name
    """
    name = name.strip()
    if not name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Model name cannot be blank")

    query = select(Model.id).where(
        Model.team_id == team_id, func.lower(Model.name) == name.lower()
    )
    if exclude_id is not None:
        query = query.where(Model.id != exclude_id)

    if (await session.execute(query)).scalar_one_or_none() is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"This team already has a model named '{name}'"
        )

    return name


async def _get_model_as_member(
    model_id: uuid.UUID,
    user_id: uuid.UUID,
    session: AsyncSession,
    *,
    options: Sequence[Any] = (),
    detail: str = "Not a member of this team",
) -> Model:
    """Fetch a model by ``model_id``, enforcing that ``user_id` is part of its team.

    Raises: 404 - Not found if the model doesn't exist
    Raises: 403 - Forbidden if the user is not a member of the model's team
    """

    model = await _get_model(model_id, session, options=options)
    await require_team_member(user_id, model.team_id, session, detail=detail)

    return model


async def _load_model_detail(
    model_id: uuid.UUID,
    user: User | None,
    session: AsyncSession,
) -> ModelDetail:
    """Return a model's details, including its submissions.

    Anonymous viewers and non-team members see only public submissions; a member of the
    model's team sees all of them, public or private.

    A model with nothing public is not readable by a non-member at all.

    Raises: 404 - Not found if the model doesn't exist, or is not the caller's to see
    """
    model = await _get_model(
        model_id,
        session,
        options=[
            selectinload(Model.team),
            selectinload(Model.submissions)
            .selectinload(Submission.task_submissions)
            .selectinload(TaskSubmission.score),
        ],
    )

    member = user is not None and await is_team_member(user.id, model.team_id, session)

    submissions: list[Submission]
    if member:
        submissions = model.submissions
    else:
        submissions = [s for s in model.submissions if s.is_public]

        if not submissions:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Model not found")

    return ModelDetail.from_model(model, submissions=submissions, is_mine=member)


# ── Endpoints ──────────────────────────────────────────────────────
@router.get("", response_model=list[ModelResponse])
async def list_models(
    team_id: uuid.UUID | None = None,
    user: User | None = Depends(get_current_user_optional),
    session: AsyncSession = Depends(get_session),
) -> list[ModelResponse]:
    """List all models. Newest first.

    Anonymous callers see only models with at least one public submission

    An authenticated user additionally sees every model on a team they belong
    to, whether or not it has a public submission.

    ``team_id`` narrows the list to one team, for a team page listing what it has
    registered. It narrows what is *shown*, never what is visible: a team the caller isn't
    in still yields only its models with a public submission.
    """
    visible = await visible_models(user, session)

    query = (
        select(Model)
        .options(selectinload(Model.team))
        .where(visible)
        .order_by(Model.created_at.desc())
    )

    if team_id is not None:
        query = query.where(Model.team_id == team_id)

    models = (await session.execute(query)).scalars().all()

    # Find the countable submissions based on authentication
    visible = await visible_submissions(user, session)
    n_submissions = await submission_count_per_model(visible, session)
    suites = await suites_per_model(visible, session)

    # One query for the whole listing rather than a membership check per row.
    my_team_ids = await member_team_ids(user.id if user else None, session)

    return [
        ModelResponse.from_model(
            model,
            n_submissions=n_submissions.get(model.id, 0),
            task_suites=suites.get(model.id, []),
            is_mine=model.team_id in my_team_ids,
        )
        for model in models
    ]


@router.post("", response_model=ModelDetail, status_code=status.HTTP_201_CREATED)
async def create_model(
    body: ModelCreate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ModelDetail:
    """Create a model.

    Only members of the model's team are allowed to create it.

    Raises: 403 - Forbidden if the user is not part of the model's team.
    """
    await require_team_member(user.id, body.team_id, session)

    name = await _check_valid_model_name(body.name, body.team_id, session)

    model = Model(**{**body.model_dump(), "name": name})
    session.add(model)
    await session.commit()

    return await _load_model_detail(model.id, user, session)


@router.get("/{model_id}", response_model=ModelDetail)
async def get_model(
    model_id: uuid.UUID,
    user: User | None = Depends(get_current_user_optional),
    session: AsyncSession = Depends(get_session),
) -> ModelDetail:
    """Get a model by ``model_id``.

    A member of the model's team sees every submission; anyone else sees only the public
    ones, and can't read the model at all unless there is at least one.

    Raises: 404 - Not found if the model doesn't exist, or has nothing the caller may see
    """
    return await _load_model_detail(model_id, user, session)


@router.get("/{model_id}/ranking", response_model=ModelRanking)
async def get_model_ranking(
    model_id: uuid.UUID,
    user: User | None = Depends(get_current_user_optional),
    session: AsyncSession = Depends(get_session),
) -> ModelRanking:
    """Where a model stands, publicly and with its private work counted.

    Two rankings against one field. The field is every *other* model's public standing —
    other teams' private work is not ours to rank against — so the competitors are
    identical in both and the only thing that moves is this model's own entry. The
    difference between the two is therefore exactly what publishing would change.

    Each side takes the model's newest score for every task, from whichever submission
    holds it: the public side from its public submissions, the private side from all of
    them. ``tasks`` names the entry each side used, so a client can say which of its rows
    are carrying which ranking.

    Only completed submissions count, on either side — an attempt still being scored has
    no result to rank.

    ``private`` is omitted for a caller who is not on the model's team.

    Raises: 404 - Not found if the model doesn't exist, or has nothing the caller may see
    """
    model = await _get_model(
        model_id,
        session,
        options=[
            selectinload(Model.submissions)
            .selectinload(Submission.task_submissions)
            .selectinload(TaskSubmission.score),
        ],
    )

    member = user is not None and await is_team_member(user.id, model.team_id, session)

    # The same rule as the model detail: a model with nothing public is not readable by a
    # non-member at all, rather than readable with an empty ranking.
    if not member and not any(submission.is_public for submission in model.submissions):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Model not found")

    mine = [s for s in model.submissions if s.status == SubmissionStatus.done]

    # The model's own submissions are left out: its standing is built separately, below,
    # and a model must not appear in the field it is being placed against.
    others = (
        await session.execute(
            select(Submission)
            .where(
                Submission.is_public.is_(True),
                Submission.status == SubmissionStatus.done,
                Submission.model_id != model_id,
            )
            .options(
                selectinload(Submission.task_submissions).selectinload(TaskSubmission.score)
            )
        )
    ).scalars().all()

    field = standings(others)
    tasks = (await session.execute(select(Task))).scalars().all()

    def side(label: str, submissions: list[Submission]) -> tuple[RankingSide, dict[str, TaskSubmission]]:
        """Place ``submissions`` as one standing against the shared field.

        ``label`` is only how the standing's own result is found again in what
        ``place_standings`` returns. A word rather than the model id: the field labels its
        standings by model, and two entries sharing a label would silently merge their
        scores rather than raise.
        """
        standing = Standing(label=label, entries=latest_entries(submissions))
        placings = place_standings([*field, standing], tasks)[label]

        return RankingSide.from_placings(placings), standing.entries

    public, public_entries = side("public", [s for s in mine if s.is_public])
    private, private_entries = side("private", mine) if member else (None, {})

    def entry(entries: dict[str, TaskSubmission], task_id: str) -> TaskEntryRef | None:
        """The entry that side used for ``task_id``, or nothing where it has no score for it."""
        return TaskEntryRef.model_validate(entries[task_id]) if task_id in entries else None

    return ModelRanking(
        model_id=model.id,
        public=public,
        private=private,
        tasks={
            task_id: TaskEntrySides(
                public=entry(public_entries, task_id),
                private=entry(private_entries, task_id),
            )
            for task_id in sorted({*public_entries, *private_entries})
        },
    )


@router.get("/{model_id}/breakdown", response_model=ModelBreakdown)
async def get_model_breakdown(
    model_id: uuid.UUID,
    task_submission_id: Annotated[list[uuid.UUID] | None, Query()] = None,
    user: User | None = Depends(get_current_user_optional),
    session: AsyncSession = Depends(get_session),
) -> ModelBreakdown:
    """A model's parameters, and the task entries it currently stands on.

    Two ways to say which entries, and they answer different questions:

    * **no ids** — the newest scored entry for each task, which is where the model stands
      today. What a listing wants: it has a model and needs the current picture.
    * **``task_submission_id``, repeated** — exactly those entries and no others. What a
      caller already looking at a set of scores wants: a leaderboard row names the entries
      it ranked, and re-deriving "newest" here could answer with a different run than the
      one on the reader's screen — a filtered board stands on the newest *matching* entry,
      which is not always the newest.

    Ids naming a task submission of another model, or one this caller may not see, are
    ignored rather than refused: what is returned is the intersection of what was asked for
    and what is theirs to read, so the endpoint says nothing about whether the rest exists.

    Only completed submissions count either way — an attempt still being scored has no
    result to stand on — and only the ones this caller may see, which is the model detail's
    rule. So a member reading their own model gets their private entries too, and this can
    differ from what the public leaderboard showed. That is the reason the ids exist.

    Raises: 404 - Not found if the model doesn't exist, or has nothing the caller may see
    """
    model = await _get_model(
        model_id,
        session,
        options=[
            selectinload(Model.team),
            selectinload(Model.submissions)
            .selectinload(Submission.task_submissions)
            .selectinload(TaskSubmission.score),
        ],
    )

    member = user is not None and await is_team_member(user.id, model.team_id, session)

    visible = [s for s in model.submissions if member or s.is_public]

    # The same rule as the model detail: a model with nothing public is not readable by a
    # non-member at all, rather than readable with an empty breakdown.
    if not visible:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Model not found")

    done = [s for s in visible if s.status == SubmissionStatus.done]

    if task_submission_id is None:
        entries = latest_entries(done)
    else:
        wanted = set(task_submission_id)

        # One per task still, so a caller naming two entries for one task gets the newer —
        # ``latest_entries`` is walking newest-first, and this only narrows what it may pick.
        #
        # ``eligible`` and not ``keep``: these ids *are* the candidates, so anything outside
        # the set is not one. ``keep`` asks the other question — whether the newest entry
        # qualifies — and would drop a task whose newest entry this caller didn't name, which
        # is exactly the entry a leaderboard row is asking to be described instead of.
        entries = latest_entries(done, eligible=lambda entry: entry.id in wanted)

    return ModelBreakdown.from_model(
        model,
        is_mine=member,
        tasks={
            task_id: TaskBreakdown.from_entry(entry)
            for task_id, entry in entries.items()
        },
    )


@router.patch("/{model_id}", response_model=ModelDetail)
async def update_model(
    model_id: uuid.UUID,
    body: ModelUpdate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ModelDetail:
    """Update a model by ``model_id``.

    Only accessible to members of the model's team.

    Checks membership of the target team.

    Raises: 404 - Not found if the model doesn't exist
    Raises: 403 - Forbidden if the user is not part of the model's team or
    the team of the new model.
    """
    model = await _get_model_as_member(
        model_id, user.id, session, detail="Not a member of this model's team"
    )

    updates = body.model_dump(exclude_unset=True)

    # Both handled separately: reassignment needs its own permission check, and the name
    # has to be checked against whichever team the model ends up in.
    new_team_id = updates.pop("team_id", None)
    new_name = updates.pop("name", None)

    # Everything is checked before anything is assigned. Assigning first would let the
    # unique index fire during the autoflush that the name query triggers, turning a
    # clean 409 into an IntegrityError from inside a SELECT.
    team_id = new_team_id if new_team_id is not None else model.team_id

    if new_team_id is not None and new_team_id != model.team_id:
        await require_team_member(
            user.id, new_team_id, session, detail="Not a member of the target team"
        )

    # A move alone can collide, without any rename: the destination team may already have
    # a model by this name. So the check runs whenever either half changes.
    name = None
    if new_team_id is not None or new_name is not None:
        name = await _check_valid_model_name(
            new_name if new_name is not None else model.name,
            team_id,
            session,
            exclude_id=model.id,
        )

    model.team_id = team_id
    if name is not None:
        model.name = name

    for field, value in updates.items():
        setattr(model, field, value)

    await session.commit()

    return await _load_model_detail(model.id, user, session)
