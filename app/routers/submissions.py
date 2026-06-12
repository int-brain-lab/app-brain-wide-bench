"""Submission endpoints: presign upload, mark complete, list, detail."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import get_current_user
from app.database import get_session
from app.models import Role, Submission, SubmissionStatus, SubmissionUser, Task, User
from app.scoring import get_scorer
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
    """Create a pending submission and return a presigned S3 PUT URL.

    Rejects unsupported tasks with HTTP 400.
    """
    try:
        get_scorer(body.task)  # validate task is supported
    except KeyError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unsupported task: {body.task}") from exc

    # Generate the id in Python so the S3 key can be built without a flush
    # (flushing here would make `links.append` trigger an async lazy-load).
    submission = Submission(
        id=uuid.uuid4(),
        title=body.title,
        description=body.description,
        affiliation=body.affiliation,
        email=body.email,
        doi=body.doi,
        is_public=body.is_public,
        task=Task(body.task),
        s3_key="",
    )
    submission.s3_key = f"submissions/{submission.id}/{body.task}.zip"
    submission.links.append(SubmissionUser(user=user, role=Role.owner))
    session.add(submission)
    await session.commit()

    return PresignResponse(
        submission_id=submission.id,
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
    """Return a submission's detail; owner or collaborator only."""
    return await _get_owned(session, submission_id, user)


async def _get_owned(
    session: AsyncSession, submission_id: uuid.UUID, user: User
) -> Submission:
    """Fetch a submission, enforcing that ``user`` is owner or collaborator."""
    submission = (
        await session.execute(
            select(Submission)
            .options(selectinload(Submission.links))
            .where(Submission.id == submission_id)
        )
    ).scalar_one_or_none()
    if submission is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Submission not found")
    if not any(link.user_id == user.id for link in submission.links):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not authorised for this submission")
    return submission
