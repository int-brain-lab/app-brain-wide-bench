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

    Rejects unknown task IDs with HTTP 400.
    """
    known_ids = set(
        (await session.execute(select(Task.id))).scalars().all()
    )
    bad = set(body.task_ids) - known_ids
    if bad:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown task IDs: {sorted(bad)}")

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
    for task_id in body.task_ids:
        session.add(TaskSubmission(submission_id=sub_id, task_id=task_id))
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
) -> Submission:
    """Mark the upload complete and enqueue the scoring task."""
    submission = await _get_owned(session, submission_id, user)
    submission.status = SubmissionStatus.pending
    await session.commit()
    score_submission.delay(str(submission.id))
    await session.refresh(submission)
    return submission


@router.get("/", response_model=list[SubmissionResponse])
async def list_submissions(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[Submission]:
    """List the current user's submissions, newest first."""
    result = await session.execute(
        select(Submission)
        .join(SubmissionUser)
        .where(SubmissionUser.user_id == user.id)
        .order_by(Submission.created_at.desc())
    )
    return list(result.scalars().all())


@router.get("/{submission_id}", response_model=SubmissionDetail)
async def get_submission(
    submission_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Submission:
    """Return a submission's detail with per-task scores; owner or collaborator only."""
    return await _get_owned(session, submission_id, user, load_scores=True)


async def _get_owned(
    session: AsyncSession,
    submission_id: uuid.UUID,
    user: User,
    load_scores: bool = False,
) -> Submission:
    """Fetch a submission, enforcing that ``user`` is owner or collaborator."""
    opts = [selectinload(Submission.user_links)]
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