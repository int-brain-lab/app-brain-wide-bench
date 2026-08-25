"""Submission endpoints"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from typing import Any, Iterable, Sequence
from collections import Counter

from app.auth import (
    get_current_user,
    get_current_user_optional,
    is_team_member,
    member_team_ids,
    require_team_member,
)
from app.database import get_session
from app.models import (
    Submission,
    SubmissionStatus,
    SubmissionUser,
    SubmissionUserRole,
    Task,
    TaskScore,
    TaskSubmission,
    TaskSuite,
    User,
    Model,
)
from app.schemas.submissions import (
    PresignResponse,
    SubmissionCreate,
    SubmissionDetail,
    SubmissionResponse,
    SubmissionUpdate,
)

from app.storage import presign_put, submission_key
from app.tasks.score import score_submission


router = APIRouter(prefix="/api/submissions", tags=["submissions"])

# ── Per-submission aggregates ──────────────────────────────────────────────────────


def submissions_of_teams(team_ids: Iterable[uuid.UUID]) -> ColumnElement[bool]:
    """Return an expression that is True for submissions belonging to ``team_ids``.

    Through the model, because that is the only place a submission's team is recorded —
    the row itself names a model, and the model names the team. One helper rather than the
    subquery written out at each call site, so "whose submission is this" is answered the
    same way everywhere.
    """
    return Submission.model_id.in_(
        select(Model.id).where(Model.team_id.in_(list(team_ids)))
    )


async def visible_submissions(
    user: User | None,
    session: AsyncSession,
) -> ColumnElement[bool]:
    """Return a SQLAlchemy expression that evaluates to True for submissions visible to the user."""

    public_submission = Submission.is_public.is_(True)

    if user is None:
        return public_submission

    my_team_ids = await member_team_ids(user.id, session)

    return or_(public_submission, submissions_of_teams(my_team_ids))


async def suites_per_submission(
    submission_ids: Sequence[uuid.UUID],
    session: AsyncSession,
) -> dict[uuid.UUID, list[TaskSuite]]:
    """Return the task suites per submission in ``submission_ids``.

    Returns a dict of {submissionId: [TaskSuite]}.
    """
    if not submission_ids:
        return {}

    rows = await session.execute(
        select(TaskSubmission.submission_id, Task.task_suite)
        .join(Task, Task.id == TaskSubmission.task_id)
        .join(TaskScore, TaskScore.task_submission_id == TaskSubmission.id)
        .where(TaskSubmission.submission_id.in_(list(submission_ids)))
        .distinct()
    )

    suites: dict[uuid.UUID, list[TaskSuite]] = {}
    for submission_id, suite in rows.all():
        suites.setdefault(submission_id, []).append(suite)

    return suites


# ── Helper functions ──────────────────────────────────────────────────────
async def _get_submission(
    submission_id: uuid.UUID,
    session: AsyncSession,
    options: Sequence[Any] = (),
) -> Submission:
    """Fetch a submission by ``submission_id``, applying any loader ``options``.

    Raises: 404 - Not found if the submission doesn't exist
    """

    submission = (
        await session.execute(
            select(Submission)
            .options(
                selectinload(Submission.user_links),
                selectinload(Submission.model).selectinload(Model.team),
                *options,
            )
            .where(Submission.id == submission_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()

    if submission is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Submission not found")

    return submission


async def _get_submission_as_member(
    submission_id: uuid.UUID,
    user_id: uuid.UUID,
    session: AsyncSession,
    *,
    options: Sequence[Any] = (),
) -> Submission:
    """Fetch a submission by ``submission_id``, enforcing that ``user_id`` is part of the submission's team.

    Raises: 404 - Not found if the submission doesn't exist
    Raises: 403 - Forbidden if the user is not a member of the submission's team
    """

    submission = await _get_submission(submission_id, session, options=options)
    await require_team_member(user_id, submission.model.team_id, session)

    return submission


async def _get_submission_as_user(
    submission_id: uuid.UUID,
    user_id: uuid.UUID,
    session: AsyncSession,
    *,
    options: Sequence[Any] = (),
) -> Submission:
    """Fetch a submission by ``submission_id``, enforcing that ``user_id`` is owner or collaborator.

    Raises: 404 - Not found if the submission doesn't exist
    Raises: 403 - Forbidden if the user is not linked to the submission
    """

    submission = await _get_submission(submission_id, session, options=options)
    if not any(link.user_id == user_id for link in submission.user_links):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not authorised for this submission")
    return submission


async def _get_submission_as_viewer(
    submission_id: uuid.UUID,
    user_id: uuid.UUID | None,
    session: AsyncSession,
    *,
    options: Sequence[Any] = (),
) -> Submission:
    """Fetch a submission by ``submission_id``, enforcing only that the caller may *read* it.

    Public submissions are readable by anyone, signed in or not; a private one only by
    its team. The read counterpart of ``_get_submission_as_member``, which stays the rule
    for changing anything — publishing a submission opens it to being seen, not edited.

    The same rule ``visible_submissions`` applies to the listings, for one submission
    rather than as a WHERE clause.

    Raises: 404 - Not found if the submission doesn't exist
    Raises: 403 - Forbidden if it is private and the caller is not a member of its team
    """

    submission = await _get_submission(submission_id, session, options=options)

    if not submission.is_public:
        await require_team_member(user_id, submission.model.team_id, session)

    return submission


async def _get_team_from_model(
    model_id: uuid.UUID,
    session: AsyncSession,
) -> uuid.UUID:
    """Fetch the team ID associated with a model.

    Raises: 404 - Not found if the model doesn't exist
    """

    team_id = (
        await session.execute(select(Model.team_id).where(Model.id == model_id))
    ).scalar_one_or_none()

    if team_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Model not found")

    return team_id


async def _check_valid_submission_label(
    label: str,
    model_id: uuid.UUID,
    session: AsyncSession,
    *,
    exclude_id: uuid.UUID | None = None,
) -> str:
    """Check a label is not blank and is unused on ``model_id``. Returns it trimmed.

    Unique per model, not per team or globally: a label names a *run* of one model, so
    "seed-sweep" against two different models is two different things, while the same
    label twice on one model is ambiguous — it is what a results table shows as the row.
    Compared case-insensitively.

    ``exclude_id`` is the submission being updated, so keeping its own label is not a
    conflict with itself. Pass the *destination* model when a PATCH repoints it.

    Raises: 422 - Unprocessable Content if the label is blank
    Raises: 409 - Conflict if the model already has a submission with that label
    """
    label = label.strip()
    if not label:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Submission label cannot be blank"
        )

    query = select(Submission.id).where(
        Submission.model_id == model_id, func.lower(Submission.label) == label.lower()
    )
    if exclude_id is not None:
        query = query.where(Submission.id != exclude_id)

    if (await session.execute(query)).scalar_one_or_none() is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"This model already has a submission labelled '{label}'",
        )

    return label


async def _validate_task_ids(
    task_ids: list[str], session: AsyncSession
) -> None:
    """Check that all task IDS are valid and that there are no duplicates.

    Raises: 400 - Bad request
    """
    known = set(
        (await session.execute(select(Task.id).where(Task.id.in_(list(task_ids))))).scalars().all()
    )
    unknown = sorted(set(task_ids) - known)
    if unknown:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown task IDs: {unknown}")

    # A task can only appear once
    duplicates = sorted(t for t, count in Counter(task_ids).items() if count > 1)
    if duplicates:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Duplicate task IDs: {duplicates}")


async def _load_submission_detail(
    submission_id: uuid.UUID,
    user_id: uuid.UUID | None,
    session: AsyncSession,
) -> SubmissionDetail:
    """Return a submission's details, with its tasks and their scores.

    Raises: 404 - Not found if the submission doesn't exist
    Raises: 403 - Forbidden if it is private and the caller is not a member of its team
    """

    submission = await _get_submission_as_viewer(
        submission_id,
        user_id,
        session,
        options=[selectinload(Submission.task_submissions).selectinload(TaskSubmission.score)],
    )

    detail = SubmissionDetail.from_submission(submission)

    if await is_team_member(user_id, submission.model.team_id, session):
        return detail.model_copy(update={"is_mine": True})

    return detail.withhold_private()


# ── Endpoints ──────────────────────────────────────────────────────
@router.post("/presign", response_model=PresignResponse)
async def presign(
    body: SubmissionCreate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PresignResponse:
    """Create a submission and return a presigned S3 URL for the client to upload the file.

    The submission is created before the user uploads the file. Once the client uploads the file,
    they can mark the submission as ready for scoring via the ``POST /api/submissions/{id}/submit`` endpoint.

    Only accessible to members of the submission's team.

    Raises: 403 - Forbidden if the user is not linked to the submission
    """

    # Permission lives on the model's team, which is also the submission's — it just
    # isn't written down twice.
    await require_team_member(user.id, await _get_team_from_model(body.model_id, session), session)
    await _validate_task_ids([task.task_id for task in body.tasks], session)

    label = await _check_valid_submission_label(body.label, body.model_id, session)

    # Pre-assign id so the S3 key is stable before the first flush.
    submission_id = uuid.uuid4()
    submission = Submission(
        id=submission_id,
        model_id=body.model_id,
        label=label,
        is_public=body.is_public,
        s3_key=submission_key(submission_id, label),
        narrative_public=body.narrative_public,
        narrative_private=body.narrative_private,
    )
    session.add(submission)

    submission_user = SubmissionUser(
        submission_id=submission_id, user_id=user.id, role=SubmissionUserRole.owner
    )
    session.add(submission_user)

    for task in body.tasks:
        session.add(TaskSubmission(submission_id=submission_id, **task.model_dump()))
    await session.commit()

    return PresignResponse(
        submission_id=submission_id,
        upload_url=presign_put(submission.s3_key),
        s3_key=submission.s3_key,
    )


@router.post("/{submission_id}/submit", response_model=SubmissionResponse)
async def submit(
    submission_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> SubmissionResponse:
    """Mark a submission as scoring and launch the scoring task.

    Only accessible to members of the submission's team.

    Raises: 404 - Not found if the submission doesn't exist
    Raises: 403 - Forbidden if the user is not linked to the submission
    """

    submission = await _get_submission_as_member(submission_id, user.id, session)
    submission.status = SubmissionStatus.scoring
    await session.commit()

    # Launch the scoring task asynchronously. The scoring task will update the submission
    # status to completed or failed once it is done.
    score_submission.delay(str(submission.id))

    # Reread the submission
    submission = await _get_submission_as_member(submission_id, user.id, session)
    return SubmissionResponse.from_submission(submission)


@router.get("", response_model=list[SubmissionResponse])
async def list_submissions(
    user: User | None = Depends(get_current_user_optional),
    session: AsyncSession = Depends(get_session),
) -> list[SubmissionResponse]:
    """List all submissions. Newest first.

    Adds the task suites to each submission.

    Anonymous callers see only public submissions.

    An authenticated user additionally sees every submission on a team they belong
    to, whether or not it is public.
    """

    visible = await visible_submissions(user, session)
    submissions = (
        (
            await session.execute(
                select(Submission)
                .options(selectinload(Submission.model).selectinload(Model.team))
                .where(visible)
                .order_by(Submission.created_at.desc())
            )
        )
        .scalars()
        .all()
    )

    suites = await suites_per_submission([s.id for s in submissions], session)

    # One query for the whole listing rather than a membership check per row.
    my_team_ids = await member_team_ids(user.id if user else None, session)

    return [
        SubmissionResponse.from_submission(
            submission,
            task_suites=suites.get(submission.id, []),
            is_mine=submission.model.team_id in my_team_ids,
        )
        for submission in submissions
    ]


@router.get("/{submission_id}", response_model=SubmissionDetail)
async def get_submission(
    submission_id: uuid.UUID,
    user: User | None = Depends(get_current_user_optional),
    session: AsyncSession = Depends(get_session),
) -> SubmissionDetail:
    """Get a submission by ``submission_id``.

    A public submission is readable by anyone. A private one can only be read by a team member.

    A reader outside the team gets the submission without its team-only fields; see
    ``SubmissionDetail.withhold_private``.

    Raises: 404 - Not found if the submission doesn't exist
    Raises: 403 - Forbidden if it is private and the caller is not a member of its team
    """

    return await _load_submission_detail(submission_id, user.id if user else None, session)


@router.patch("/{submission_id}", response_model=SubmissionDetail)
async def update_submission(
    submission_id: uuid.UUID,
    body: SubmissionUpdate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> SubmissionDetail:
    """Update a submission by ``submission_id``.

    Only members of the submission's team can update it.

    The only fields that can be updated are specified by SubmissionUpdate. If any other
    fields are given it raises with a 422 response.

    Moving it to another model needs membership of that model's team as well; nothing
    else changes, since the team is the model's rather than the submission's own.

    Raises: 404 - Not found if the submission doesn't exist
    Raises: 403 - Forbidden if the user is not a member of the submission's team
    Raises: 422 - Unprocessable Entity if the request body contains fields that are not allowed to be updated
    """

    submission = await _get_submission_as_member(submission_id, user.id, session)

    updates = body.model_dump(exclude_unset=True)

    # Reassignment is handled separately because it needs its own permission check on the
    # destination model's team — which is the submission's team the moment it moves.
    new_model_id = updates.pop("model_id", None)
    new_label = updates.pop("label", None)

    # Checked before anything is assigned: assigning first would let the unique index fire
    # during the autoflush that the label query triggers, turning a clean 409 into an
    # IntegrityError raised from inside a SELECT.
    model_id = new_model_id if new_model_id is not None else submission.model_id
    moved = new_model_id is not None and new_model_id != submission.model_id

    if moved:
        await require_team_member(
            user.id, await _get_team_from_model(new_model_id, session), session
        )

    # A move alone can collide, without any relabelling: the destination model may already
    # have a submission by this label. So the check runs whenever either half changes.
    label = None
    if new_model_id is not None or new_label is not None:
        label = await _check_valid_submission_label(
            new_label if new_label is not None else submission.label,
            model_id,
            session,
            exclude_id=submission.id,
        )

    if moved:
        submission.model_id = new_model_id
    if label is not None:
        submission.label = label

    for field, value in updates.items():
        setattr(submission, field, value)

    await session.commit()

    # A member by this point, so nothing is withheld.
    return await _load_submission_detail(submission_id, user.id, session)
