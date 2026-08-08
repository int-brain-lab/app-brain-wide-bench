"""Task submission endpoints: the per-task rows hanging off one submission."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_session
from app.models import TaskSubmission, User
from app.schemas.tasksubmission import (
    TaskSubmissionBulkUpdate,
    TaskSubmissionDetail,
    TaskSubmissionUpdate,
)
from app.auth import get_current_user
from app.routers.submissions import _get_submission_as_team

router = APIRouter(
    prefix="/api/submissions/{submission_id}/tasks")

_TASK_SUBMISSION_NOT_FOUND = "Task submission not found on this submission"


async def _get_task_submission(
    session: AsyncSession, submission_id:uuid.UUID, user_id: uuid.UUID, task_submission_id: uuid.UUID
) -> TaskSubmission:
    """Fetch a task submission with its score, asserting it belongs to the parent."""
    submission = await _get_submission_as_team(session, submission_id, user_id)

    task_submission = (
        await session.execute(
            select(TaskSubmission)
            .options(selectinload(TaskSubmission.score))
            .where(
                TaskSubmission.id == task_submission_id,
                TaskSubmission.submission_id == submission.id,
            )
        )
    ).scalar_one_or_none()
    if task_submission is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, _TASK_SUBMISSION_NOT_FOUND)
    return task_submission


@router.get("", response_model=list[TaskSubmissionDetail])
async def list_task_submissions(
    submission_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[TaskSubmissionDetail]:
    """List one submission's task submissions, with scores attached

    Order by task_id
    """
    _ = await _get_submission_as_team(session, submission_id, user.id)
    task_submissions = (
        (
            await session.execute(
                select(TaskSubmission)
                .options(selectinload(TaskSubmission.score))
                .where(TaskSubmission.submission_id == submission_id)
                .order_by(TaskSubmission.task_id)
            )
        )
        .scalars()
        .all()
    )
    return [TaskSubmissionDetail.model_validate(ts) for ts in task_submissions]


@router.patch("", response_model=list[TaskSubmissionDetail])
async def update_task_submissions(
    submission_id: uuid.UUID,
    body: TaskSubmissionBulkUpdate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[TaskSubmissionDetail]:
    """Apply the same training metadata to several of one submission's tasks.

    All or nothing. Every id is checked against this submission *before* anything is
    written, so an id belonging to someone else's submission — or to no submission —
    rejects the whole request rather than leaving some rows updated and some not. That
    is the point of doing this in one call instead of N: the client can't produce a
    half-applied state by failing partway through.

    Returns the updated rows in task_id order, so the caller can say which tasks changed
    rather than assuming its request list is what landed.
    """
    submission = await _get_submission_as_team(session, submission_id, user.id)

    requested = set(body.task_submission_ids)

    task_submissions = (
        (
            await session.execute(
                select(TaskSubmission)
                .options(selectinload(TaskSubmission.score))
                .where(
                    TaskSubmission.submission_id == submission.id,
                    TaskSubmission.id.in_(list(requested)),
                )
                .order_by(TaskSubmission.task_id)
            )
        )
        .scalars()
        .all()
    )

    missing = requested - {task_submission.id for task_submission in task_submissions}
    if missing:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            f"{_TASK_SUBMISSION_NOT_FOUND}: {', '.join(str(id_) for id_ in sorted(missing))}",
        )

    # exclude_unset, so a caller changing one field doesn't null the other four on every
    # row it touches — the same semantics as the single-row PATCH above.
    updates = body.updates.model_dump(exclude_unset=True)

    for task_submission in task_submissions:
        for field, value in updates.items():
            setattr(task_submission, field, value)

    await session.commit()

    return [TaskSubmissionDetail.model_validate(ts) for ts in task_submissions]


@router.patch("/{task_submission_id}", response_model=TaskSubmissionDetail)
async def update_task_submission(
    submission_id: uuid.UUID,
    task_submission_id: uuid.UUID,
    body: TaskSubmissionUpdate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TaskSubmissionDetail:
    """Update a task submission's training metadata."""
    task_submission = await _get_task_submission(
        session, submission_id, user.id, task_submission_id
    )

    updates = body.model_dump(exclude_unset=True)

    for field, value in updates.items():
        setattr(task_submission, field, value)

    await session.commit()

    task_submission = await _get_task_submission(
        session, submission_id, user.id, task_submission_id
    )
    return TaskSubmissionDetail.model_validate(task_submission)


@router.get("/{task_submission_id}", response_model=TaskSubmissionDetail)
async def get_task_submission(
    submission_id: uuid.UUID,
    task_submission_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TaskSubmissionDetail:
    """Get the details of a task submission. Score is attached if it exists."""
    task_submission = await _get_task_submission(
        session, submission_id, user.id, task_submission_id
    )
    return TaskSubmissionDetail.model_validate(task_submission)
