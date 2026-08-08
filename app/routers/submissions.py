"""Submission endpoints: presign upload, mark complete, list, detail."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from typing import Any, Sequence
from collections import Counter

from app.auth import get_current_user, member_team_ids, require_team_member
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
)
from app.schemas.submissions import (
    PresignResponse,
    SubmissionCreate,
    SubmissionDetail,
    SubmissionResponse,
    SubmissionUpdate,
)
from app.storage import presign_put
from app.tasks.score import score_submission



router = APIRouter(prefix="/api/submissions", tags=["submissions"])


# ── Task-suite summary ────────────────────────────────────────────────────────
#
# ``SubmissionList.task_suites``: which suites a submission has results for. The
# counterpart of ``model_stats`` in app/routers/models.py, and shared with
# ``GET /api/users/me/submissions`` the same way that one is.
#
# For the *list* routes only. A detail response embeds its task_submissions in full,
# so a client derives the same answer from those; summarising it again there would just
# be a second thing to keep in step.
#
# Computed in SQL rather than by walking ``Submission.task_submissions``, which would
# need task_submissions → task → score eagerly loaded on every list row to produce a
# few enum values.

# Same ordering as the models router's aggregate, so a submission's badges line up
# with a model's.
_SUITE_ORDER = {suite: index for index, suite in enumerate(TaskSuite)}


async def suites_by_submission(
    session: AsyncSession, submission_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[TaskSuite]]:
    """submission_id -> each task suite it has a *score* for, in suite order.

    Keyed on the ids being returned rather than taking a visibility predicate the way
    ``model_stats`` does. The difference is real: a model is listed publicly on the
    strength of one public submission, so its aggregates need scoping away from the
    private ones behind it. A submission is only in the list at all if the caller may
    read it — so every suite of it is theirs to see, and the ids *are* the scope.

    Joined through TaskScore, so a suite counts only once it has a result; a pending or
    failed task contributes nothing. ``Task.task_suite`` is authoritative rather than
    the ``"ts1-"`` prefix on ``task_id``, which is the display convention the frontend
    parses.

    A plain dict, so a submission with no scores is simply absent and callers use
    ``.get(id, [])``.
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

    for submission_suites in suites.values():
        submission_suites.sort(key=lambda suite: _SUITE_ORDER[suite])

    return suites


async def _get_submission_or_404(
    session: AsyncSession,
    submission_id: uuid.UUID,
    *options: Any
) -> Submission:

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

async def _get_submission_as_team(
    session: AsyncSession,
    submission_id: uuid.UUID,
    user_id: uuid.UUID,
    *options: Any
) -> Submission:
    """Fetch a submission by id, enforcing that ``user_id`` is part of the submission's team.

    404 is submission doesn't exist, 403 if user is not part of team.
    """

    submission = await _get_submission_or_404(session, submission_id, *options)
    await require_team_member(session, user_id, submission.team_id)

    return submission


async def _get_submission_as_user(
    session: AsyncSession,
    submission_id: uuid.UUID,
    user_id: uuid.UUID,
    *options: Any
) -> Submission:
    """Fetch a submission by id, enforcing that ``user_id`` is owner or collaborator.

    404 is submission doesn't exist, 403 if user is not linked to it.
    """

    submission = await _get_submission_or_404(session, submission_id, *options)
    if not any(link.user_id == user_id for link in submission.user_links):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not authorised for this submission")
    return submission




async def _validate_task_ids(session: AsyncSession, task_ids: Sequence[str]) -> None:
    """Reject task IDs that are unknown, or that appear more than once, with 400."""
    known = set(
        (await session.execute(select(Task.id).where(Task.id.in_(list(task_ids)))))
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


@router.post("/presign", response_model=PresignResponse)
async def presign(
    body: SubmissionCreate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PresignResponse:
    """Create a submission and return a presigned S3 URL for the client to upload the file.

    The submission is created before the user uploads the file. Once the client uploads the file,
    they can mark the submission as ready for scoring via the ``POST /api/submissions/{id}/submit`` endpoint.

    Rejects unknown or repeated task IDs with HTTP 400, and a team the caller
    isn't a member of with HTTP 403.
    """

    await require_team_member(session, user.id, body.team_id)
    await _validate_task_ids(session, [task.task_id for task in body.tasks])

    # Pre-assign id so the S3 key is stable before the first flush.
    submission_id = uuid.uuid4()
    submission = Submission(
        id=submission_id,
        team_id=body.team_id,
        model_id=body.model_id,
        label=body.label,
        is_public=body.is_public,
        s3_key=f"submissions/{submission_id}/{body.label}.zip",
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
    """Once the file has been uploaded to s3 via the presign url update the submission status to pending
    to trigger scoring."""
    submission = await _get_submission_as_user(session, submission_id, user.id)
    submission.status = SubmissionStatus.pending
    await session.commit()
    score_submission.delay(str(submission.id))

    # Reread the submission
    submission = await _get_submission_as_user(session, submission_id, user.id)
    return SubmissionResponse.from_submission(submission)



@router.get("", response_model=list[SubmissionResponse])
async def list_submissions(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[SubmissionResponse]:
    """List submissions belonging to any team the caller is a member of. Newest first.

    Team-scoped rather than keyed on ``SubmissionUser``, matching what
    ``_get_submission_as_team`` allows on the detail route — a lab sees its own
    runs. Writes stay narrower; see ``_get_submission_as_user``.

    An empty set of teams yields an empty ``IN (...)``, which is correctly no rows.
    """
    my_team_ids = await member_team_ids(session, user.id)
    submissions = (
        (
            await session.execute(
                select(Submission)
                .options(
                    selectinload(Submission.team),
                    selectinload(Submission.model))
                .where(Submission.team_id.in_(list(my_team_ids)))
                .order_by(Submission.created_at.desc())
            )
        )
        .scalars()
        .all()
    )

    suites = await suites_by_submission(session, [s.id for s in submissions])

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
    """Return a submission's detail with per-task scores; Shows any submissions that belong to team."""

    submission = await _get_submission_as_team(session, submission_id, user.id,
                                               selectinload(Submission.task_submissions)
                                               .selectinload(TaskSubmission.score))

    return SubmissionDetail.from_submission(submission)


@router.patch("/{submission_id}", response_model=SubmissionDetail)
async def update_submission(
    submission_id: uuid.UUID,
    body: SubmissionUpdate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> SubmissionDetail:
    """Update a submission's label, visibility or narratives; owner or collaborator only.

    The model, team, storage key and status are immutable — see SubmissionUpdate.

    Note that flipping ``is_public`` is a publishing action: it changes what
    ``GET /api/leaderboard`` and the public model card expose.
    """

    submission = await _get_submission_as_user(session, submission_id, user.id)

    updates = body.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(submission, field, value)

    await session.commit()

    submission = await _get_submission_as_user(session, submission_id, user.id)

    return SubmissionResponse.from_submission(submission)
