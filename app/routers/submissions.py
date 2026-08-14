"""Submission endpoints"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from typing import Any, Sequence
from collections import Counter

from app.auth import get_current_user, require_team_member
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

from app.auth import (
    get_current_user,
    get_current_user_optional,
    require_team_member,
    member_team_ids,
)
from app.storage import presign_put, submission_key
from app.tasks.score import score_submission



router = APIRouter(prefix="/api/submissions", tags=["submissions"])

# ── Per-submission aggregates ──────────────────────────────────────────────────────

async def visible_submissions(
        user: User | None = Depends(get_current_user_optional),
        session: AsyncSession = Depends(get_session)) -> ColumnElement[bool]:
    """Return a SQLAlchemy expression that evaluates to True for submissions visible to the user."""

    public_submission = Submission.is_public.is_(True)

    if user is None:
        return public_submission

    my_team_ids = await member_team_ids(user.id, session)

    return or_(
        public_submission,
        Submission.team_id.in_(list(my_team_ids)),
    )

async def suites_per_submission(
    submission_ids: Sequence[uuid.UUID],
    session: AsyncSession = Depends(get_session),
) -> dict[uuid.UUID, list[TaskSuite]]:
    """Return the task suites per submission in ``submission_ids``.

    Returns a dict of {submissionId: [TaskSuite]}.

    Takes no visibility predicate, unlike its counterparts in the models router. It
    doesn't need one: a submission is only in ``submission_ids`` if the caller may
    already read it, so the ids *are* the scope. A ``Submission``-based predicate would
    also be wrong here — this query joins TaskSubmission → Task → TaskScore and never
    reaches ``submissions``, so adding one would cross-join the whole table.
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
    *,
    options: Sequence[Any] = (),
) -> Submission:
    """Fetch a submission by ``submission_id``, applying any loader ``options``.

    ``options`` is keyword-only: passed positionally into a ``*options`` varargs, a list
    used to reach SQLAlchemy as ``([Load],)`` and fail there, one frame deep in a query
    build, rather than at the call.

    Raises: 404 - Not found if the submission doesn't exist
    """

    submission = (
        await session.execute(
            select(Submission).options(
                selectinload(Submission.user_links),
                    selectinload(Submission.team),
                    selectinload(Submission.model),
                    *options)
            .where(Submission.id == submission_id)
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
    await require_team_member(user_id, submission.team_id, session)

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


async def get_team_from_model(
    model_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
) -> uuid.UUID:
    """Fetch the team ID associated with a model.

    Raises: 404 - Not found if the model doesn't exist
    """

    team_id = (
        await session.execute(
            select(Model.team_id)
            .where(Model.id == model_id)
        )
    ).scalar_one_or_none()

    if team_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Model not found")

    return team_id


async def _validate_task_ids(
        task_ids: list[str],
        session: AsyncSession = Depends(get_session)
) -> None:
    """Check that all task IDS are valid and that there are no duplicates.

    Raises: 400 - Bad request
    """
    known = set(
        (await session.execute(
            select(Task.id)
            .where(Task.id.in_(list(task_ids)))))
            .scalars()
            .all()
    )
    unknown = sorted(set(task_ids) - known)
    if unknown:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown task IDs: {unknown}")

    # A task can only appear once
    duplicates = sorted(t for t, count in Counter(task_ids).items() if count > 1)
    if duplicates:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"Duplicate task IDs: {duplicates}"
        )

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

    Raises: 404 - Not found if the submission doesn't exist
    Raises: 403 - Forbidden if the user is not linked to the submission
    """

    # Get the team id from the model.
    team_id = await get_team_from_model(body.model_id, session)

    await require_team_member(user.id, team_id, session)
    await _validate_task_ids([task.task_id for task in body.tasks], session)

    # Pre-assign id so the S3 key is stable before the first flush.
    submission_id = uuid.uuid4()
    submission = Submission(
        id=submission_id,
        team_id=team_id,
        model_id=body.model_id,
        label=body.label,
        is_public=body.is_public,
        s3_key=submission_key(submission_id, body.label),
        narrative_public=body.narrative_public,
        narrative_private=body.narrative_private,
    )
    session.add(submission)

    submission_user = SubmissionUser(
        submission_id=submission_id,
        user_id=user.id,
        role=SubmissionUserRole.owner)
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
    """Mark a submission as ready for scoring.

    Only accessible to members of the submission's team.

    Raises: 404 - Not found if the submission doesn't exist
    Raises: 403 - Forbidden if the user is not linked to the submission
    """

    submission = await _get_submission_as_member(submission_id, user.id, session)
    submission.status = SubmissionStatus.pending
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
                .options(
                    selectinload(Submission.team),
                    selectinload(Submission.model))
                .where(visible)
                .order_by(Submission.created_at.desc())
            )
        )
        .scalars()
        .all()
    )

    suites = await suites_per_submission([s.id for s in submissions], session)

    return [
        SubmissionResponse.from_submission(
            submission,
            task_suites=suites.get(submission.id, []),
        )
        for submission in submissions
    ]


@router.get("/{submission_id}", response_model=SubmissionDetail)
async def get_submission(
    submission_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> SubmissionDetail:
    """Get a submission by ``submission_id``.

    Only accessible to members of the submission's team.

    Raises: 404 - Not found if the submission doesn't exist
    Raises: 403 - Forbidden if the user is not linked to the submission
    """

    submission = await _get_submission_as_member(
        submission_id,
        user.id,
        session,
        options=[selectinload(Submission.task_submissions).selectinload(TaskSubmission.score)],
    )

    return SubmissionDetail.from_submission(submission)


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

    If the model_id is updated, the team_id is checked and updated accordingly.

    Raises: 404 - Not found if the submission doesn't exist
    Raises: 403 - Forbidden if the user is not a member of the submission's team
    Raises: 422 - Unprocessable Entity if the request body contains fields that are not allowed to be updated
    """

    submission = await _get_submission_as_member(submission_id, user.id, session)

    updates = body.model_dump(exclude_unset=True)

    # Reassignment is handled separately because the team follows the model and needs
    # its own permission check on the destination team.
    new_model_id = updates.pop("model_id", None)

    if new_model_id is not None and new_model_id != submission.model_id:
        team_id = await get_team_from_model(new_model_id, session)

        await require_team_member(user.id, team_id, session)
        submission.model_id = new_model_id
        submission.team_id = team_id

    for field, value in updates.items():
        setattr(submission, field, value)

    await session.commit()

    submission = await _get_submission_as_member(
        submission_id,
        user.id,
        session,
        options=[selectinload(Submission.task_submissions).selectinload(TaskSubmission.score)],
    )

    return SubmissionDetail.from_submission(submission)
