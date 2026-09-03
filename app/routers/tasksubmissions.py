"""Task submission endpoints: the per-task rows hanging off one submission, and the flat
listing of every one the caller may see."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_session
from app.models import Model, Submission, TaskSubmission, User
from app.schemas.tasksubmission import (
    TaskSubmissionBulkUpdate,
    TaskSubmissionDetail,
    TaskSubmissionResponse,
    TaskSubmissionUpdate,
)
from app.auth import get_current_user, get_current_user_optional
from app.routers.submissions import (
    _get_submission_as_member,
    _get_submission_as_viewer,
    visible_submissions,
)

# Tagged as its own group rather than under "submissions": these routes are about one
# submission's tasks, and /docs otherwise files them under "default".
router = APIRouter(
    prefix="/api/submissions/{submission_id}/tasks",
    tags=["task submissions"],
)


# ── Helper functions ──────────────────────────────────────────────────────
async def _get_task_submission(
    task_submission_id: uuid.UUID,
    submission: Submission,
    session: AsyncSession,
) -> TaskSubmission:
    """Fetch one of ``submission``'s task submissions by id.

    Raises 404: Not found if the task submission is not found or does not belong to the submission
    """

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
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "Task submission not found on this submission"
        )
    return task_submission


# ── Endpoints ──────────────────────────────────────────────────────
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
    rejects the whole request rather than leaving some rows updated and some not.

    Returns the updated rows in task_id order.
    """
    submission = await _get_submission_as_member(submission_id, user.id, session)

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
            f"Task submission not found on this submission: {', '.join(str(id_) for id_ in sorted(missing))}",
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
    """Update a task submission by ``task_submission_id``

    Only accessible to members of the submission's team.

    Raises: 404 - Not found if the task submission is not found or does not belong to the submission
    Raises: 403 - Forbidden if the user is not part of the submission's team.
    """
    submission = await _get_submission_as_member(submission_id, user.id, session)
    task_submission = await _get_task_submission(task_submission_id, submission, session)

    updates = body.model_dump(exclude_unset=True)

    for field, value in updates.items():
        setattr(task_submission, field, value)

    await session.commit()
    await session.refresh(task_submission)

    return TaskSubmissionDetail.model_validate(task_submission)


@router.get("/{task_submission_id}", response_model=TaskSubmissionDetail)
async def get_task_submission(
    submission_id: uuid.UUID,
    task_submission_id: uuid.UUID,
    user: User | None = Depends(get_current_user_optional),
    session: AsyncSession = Depends(get_session),
) -> TaskSubmissionDetail:
    """Get a task submission by ``task_submission_id``.

    Readable by anyone who may read the submission it belongs to: its tasks and scores
    are what a public submission publishes, so a viewer who can see the submission can
    see them. A private submission's tasks stay with its team.

    Raises: 404 - Not found if the task submission is not found or does not belong to the submission
    Raises: 403 - Forbidden if the submission is private and the caller is not in its team
    """
    submission = await _get_submission_as_viewer(
        submission_id, user.id if user else None, session
    )
    task_submission = await _get_task_submission(task_submission_id, submission, session)

    return TaskSubmissionDetail.model_validate(task_submission)


# ── Listing ──────────────────────────────────────────────────────
# Its own router because it is not one submission's tasks: the prefix above has nowhere to
# hang a route across all of them.
listing = APIRouter(prefix="/api/task-submissions", tags=["task submissions"])


@listing.get("", response_model=list[TaskSubmissionResponse])
async def list_task_submissions(
    user: User | None = Depends(get_current_user_optional),
    session: AsyncSession = Depends(get_session),
) -> list[TaskSubmissionResponse]:
    """List every task submission the caller may see.

    Anonymous callers see the tasks of public submissions; an authenticated caller also sees
    those of their own teams', whether or not they are public.

    Newest submission first, then by task, so tasks of one submission stay together — the same
    order as ``my_task_submissions``, which this is the unscoped counterpart of.
    """
    visible = await visible_submissions(user, session)

    task_submissions = (
        (
            await session.execute(
                select(TaskSubmission)
                .options(
                    selectinload(TaskSubmission.score),
                    selectinload(TaskSubmission.submission)
                    .selectinload(Submission.model)
                    .selectinload(Model.team),
                )
                .join(Submission, Submission.id == TaskSubmission.submission_id)
                .where(visible)
                .order_by(Submission.created_at.desc(), TaskSubmission.task_id)
            )
        )
        .scalars()
        .all()
    )

    return [TaskSubmissionResponse.from_task_submission(ts) for ts in task_submissions]
