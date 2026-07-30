"""Submission endpoints: presign upload, mark complete, list, detail."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import get_current_user
from app.database import get_session
from app.models import (
    Submission,
    SubmissionStatus,
    SubmissionUser,
    SubmissionUserRole,
    Task,
    TaskSubmission,
    User,
)
from app.schemas.submissions import (
    PresignResponse,
    SubmissionCreate,
    SubmissionDetail,
    SubmissionResponse,
    SubmissionUpdate,
    TaskSubmissionDetail,
    TaskSubmissionUpdate,
)
from app.storage import presign_put
from app.tasks.score import score_submission

router = APIRouter(prefix="/api/submissions", tags=["submissions"])


@router.post("/presign", response_model=PresignResponse)
async def presign(
    body: SubmissionCreate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PresignResponse:
    """Create a pending submission, its TaskSubmission rows, and return a presigned S3 PUT URL.

    Each entry in ``body.tasks`` carries that task's methodology, which is stored
    on the TaskSubmission row up front; it stays editable afterwards via
    ``PATCH /api/submissions/{id}/tasks/{task_submission_id}``.

    Rejects unknown task IDs with HTTP 400.
    """
    known_ids = set(
        (await session.execute(select(Task.id))).scalars().all()
    )
    requested_ids = [task.task_id for task in body.tasks]

    bad = set(requested_ids) - known_ids
    if bad:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown task IDs: {sorted(bad)}")

    # A task can only appear once — two rows for the same task would each carry
    # their own methodology, with nothing to say which one describes the run.
    duplicates = {task_id for task_id in requested_ids if requested_ids.count(task_id) > 1}
    if duplicates:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Duplicate task IDs: {sorted(duplicates)}")

    # Pre-assign id so the S3 key is stable before the first flush.
    sub_id = uuid.uuid4()
    submission = Submission(
        id=sub_id,
        team_id=body.team_id,
        model_id=body.model_id,
        label=body.label,
        is_public=body.is_public,
        s3_key=f"submissions/{sub_id}/{body.label}.zip",
    )
    session.add(submission)
    session.add(SubmissionUser(submission_id=sub_id, user_id=user.id, role=SubmissionUserRole.owner))
    for task in body.tasks:
        session.add(TaskSubmission(submission_id=sub_id, **task.model_dump()))
    await session.commit()

    return PresignResponse(
        submission_id=sub_id,
        upload_url=presign_put(submission.s3_key),
        s3_key=submission.s3_key,
    )


@router.post("/{submission_id}/submit", response_model=SubmissionResponse)
async def submit(
    submission_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> SubmissionResponse:
    """Mark the upload complete and enqueue the scoring task."""
    submission = await _get_owned(session, submission_id, user)
    submission.status = SubmissionStatus.pending
    await session.commit()
    score_submission.delay(str(submission.id))

    # Re-read rather than session.refresh(): refresh expires the `team` / `model`
    # relationships, and SubmissionResponse needs their names.
    return SubmissionResponse.from_submission(
        await _get_owned(session, submission_id, user)
    )


@router.get("/", response_model=list[SubmissionResponse])
async def list_submissions(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[SubmissionResponse]:
    """List the current user's submissions, newest first."""
    result = await session.execute(
        select(Submission)
        .options(selectinload(Submission.team), selectinload(Submission.model))
        .join(SubmissionUser)
        .where(SubmissionUser.user_id == user.id)
        .order_by(Submission.created_at.desc())
    )
    return [SubmissionResponse.from_submission(s) for s in result.scalars().all()]


@router.get("/{submission_id}", response_model=SubmissionDetail)
async def get_submission(
    submission_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> SubmissionDetail:
    """Return a submission's detail with per-task scores; owner or collaborator only."""
    return SubmissionDetail.from_submission(
        await _get_owned(session, submission_id, user, load_scores=True)
    )


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
    submission = await _get_owned(session, submission_id, user)

    # exclude_unset: an omitted field keeps its value, while an explicit null
    # clears it. A "skip if None" loop could never clear a narrative.
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(submission, field, value)

    await session.commit()

    return SubmissionDetail.from_submission(
        await _get_owned(session, submission_id, user, load_scores=True)
    )


@router.patch(
    "/{submission_id}/tasks/{task_submission_id}",
    response_model=TaskSubmissionDetail,
)
async def update_task_submission(
    submission_id: uuid.UUID,
    task_submission_id: uuid.UUID,
    body: TaskSubmissionUpdate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TaskSubmission:
    """Update one task's methodology metadata; owner or collaborator only.

    Allowed at any status: these fields describe *how* the run was done, so they
    don't invalidate a score that has already been computed.
    """
    # Authorisation lives on the parent submission — nested so a task submission
    # can't be reached without proving access to the submission that owns it.
    await _get_owned(session, submission_id, user)

    task_submission = await _get_task_submission(session, submission_id, task_submission_id)

    # exclude_unset: an omitted field keeps its value, while an explicit null
    # clears it. A "skip if None" loop could never clear a field back to unset.
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(task_submission, field, value)

    await session.commit()

    # Re-read rather than returning the committed instance: commit expires its
    # attributes, and `score` is a relationship — touching it lazily on an async
    # session raises MissingGreenlet (see test_submit_marks_pending_and_enqueues).
    return await _get_task_submission(session, submission_id, task_submission_id)


async def _get_task_submission(
    session: AsyncSession,
    submission_id: uuid.UUID,
    task_submission_id: uuid.UUID,
) -> TaskSubmission:
    """Fetch a task submission, with its score, asserting it belongs to ``submission_id``."""
    task_submission = (
        await session.execute(
            select(TaskSubmission)
            .options(selectinload(TaskSubmission.score))
            .where(
                TaskSubmission.id == task_submission_id,
                TaskSubmission.submission_id == submission_id,
            )
        )
    ).scalar_one_or_none()

    if task_submission is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "Task submission not found on this submission"
        )
    return task_submission


async def _get_owned(
    session: AsyncSession,
    submission_id: uuid.UUID,
    user: User,
    load_scores: bool = False,
) -> Submission:
    """Fetch a submission, enforcing that ``user`` is owner or collaborator.

    ``team`` and ``model`` are always loaded because SubmissionResponse flattens
    their names — reading them lazily after this returns would raise
    MissingGreenlet on the async session.
    """
    opts = [
        selectinload(Submission.user_links),
        selectinload(Submission.team),
        selectinload(Submission.model),
    ]
    if load_scores:
        opts.append(
            selectinload(Submission.task_submissions).selectinload(TaskSubmission.score)
        )
    submission = (
        await session.execute(
            select(Submission).options(*opts).where(Submission.id == submission_id)
        )
    ).scalar_one_or_none()
    if submission is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Submission not found")
    if not any(link.user_id == user.id for link in submission.user_links):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not authorised for this submission")
    return submission