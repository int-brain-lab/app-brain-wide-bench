"""User profile endpoints."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import get_current_user, member_team_ids
from app.database import get_session
from app.models import Model, Team, User, UserTeam, Submission, TaskSubmission

from app.routers.models import submission_count_per_model, suites_per_model
from app.routers.submissions import suites_per_submission
from app.schemas.models import ModelResponse
from app.schemas.submissions import SubmissionResponse
from app.schemas.tasksubmission import TaskSubmissionResponse
from app.schemas.teams import TeamResponse
from app.schemas.users import UserDetail, UserResponse, UserUpdate

router = APIRouter(prefix="/api/users", tags=["users"])


# ── Endpoints ──────────────────────────────────────────────────────
@router.get("", response_model=list[UserResponse])
async def search_users(
    q: str = Query(description="Email to look up, exact match only"),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[UserResponse]:
    """Look up a user by their *exact* email, for picking team members.

    Raises: 422 - Unprocessable Entity if ``q`` is missing

    Email rather than email-or-name, because ``name`` is a display name its owner may
    change to anything. Matching on it would let someone put a colleague's name on their
    own account and surface in searches meant for them.
    """
    lookup = q.strip().lower()

    result = await session.execute(
        select(User)
        .where(User.id != user.id, func.lower(User.email) == lookup)
        .order_by(User.email)
    )

    # Built here rather than returned as ORM rows for ``response_model`` to coerce: a
    # response that never states its own shape is how ``/me`` silently shipped without
    # its ``id``.
    return [UserResponse.model_validate(row) for row in result.scalars().all()]


@router.get("/me", response_model=UserDetail)
async def me(user: User = Depends(get_current_user)) -> UserDetail:
    """Return the authenticated user's profile.

    ``UserDetail`` rather than ``UserResponse``: the caller needs its own ``id`` to
    recognise itself in a team's member list, and ``UserResponse`` is only the fields
    shared with ``UserUpdate``.
    """
    return UserDetail.model_validate(user)


# ── The caller's own records ──────────────────────────────────────────────
#
# Scoped by team membership rather than by visibility: everything on a team the caller
# belongs to is theirs to see, private and pending included. That is what separates these
# from the public listings — ``GET /api/models`` answers "what may I see", these answer
# "what is mine".


@router.get("/me/models", response_model=list[ModelResponse])
async def my_models(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[ModelResponse]:
    """List all models for any team the user is a member of. Newest first.

    Adds the submission count and task suites to each model.

    The submission count contains both private and public submissions.
    """
    my_team_ids = await member_team_ids(user.id, session)

    models = (
        (
            await session.execute(
                select(Model)
                .options(selectinload(Model.team))
                .join(UserTeam, UserTeam.team_id == Model.team_id)
                .where(UserTeam.user_id == user.id)
                .order_by(Model.created_at.desc())
            )
        )
        .scalars()
        .all()
    )

    # Not ``visible_submissions``: that one answers "may the caller see this", and here
    # every row already belongs to the caller's own team. The count is of everything on
    # their models, private included — which is what the docstring above promises.
    mine = Submission.model_id.in_(select(Model.id).where(Model.team_id.in_(list(my_team_ids))))

    n_submissions = await submission_count_per_model(mine, session)
    suites = await suites_per_model(mine, session)

    return [
        ModelResponse.from_model(
            model,
            n_submissions=n_submissions.get(model.id, 0),
            task_suites=suites.get(model.id, []),
        )
        for model in models
    ]


@router.get("/me/submissions", response_model=list[SubmissionResponse])
async def my_submissions(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[SubmissionResponse]:
    """List all submissions for teams the current user is a member of. Newest first.

    Add the task suites to each submission.
    """

    my_team_ids = await member_team_ids(user.id, session)

    submissions = (
        (
            await session.execute(
                select(Submission)
                .options(selectinload(Submission.team), selectinload(Submission.model))
                .where(Submission.team_id.in_(list(my_team_ids)))
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


@router.get("/me/task-submissions", response_model=list[TaskSubmissionResponse])
async def my_task_submissions(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[TaskSubmissionResponse]:
    """List every task submission across the teams the current user is a member of.

    Newest submission first, then by task, so tasks of one submission stay together.
    """
    my_team_ids = await member_team_ids(user.id, session)

    task_submissions = (
        (
            await session.execute(
                select(TaskSubmission)
                .options(
                    selectinload(TaskSubmission.score),
                    selectinload(TaskSubmission.submission).selectinload(Submission.model),
                    selectinload(TaskSubmission.submission).selectinload(Submission.team),
                )
                .join(Submission, Submission.id == TaskSubmission.submission_id)
                .where(Submission.team_id.in_(list(my_team_ids)))
                .order_by(Submission.created_at.desc(), TaskSubmission.task_id)
            )
        )
        .scalars()
        .all()
    )

    return [TaskSubmissionResponse.from_task_submission(ts) for ts in task_submissions]


@router.get("/me/teams", response_model=list[TeamResponse])
async def my_teams(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[TeamResponse]:
    """List all teams the current user is a member of

    Adds the number of members, models, and submissions to each team.
    """
    result = await session.execute(
        select(Team)
        .options(
            selectinload(Team.members), selectinload(Team.models), selectinload(Team.submissions)
        )
        .join(UserTeam, UserTeam.team_id == Team.id)
        .where(UserTeam.user_id == user.id)
    )
    teams = result.scalars().all()

    return [
        TeamResponse.from_team(
            team,
            n_members=len(team.members),
            n_models=len(team.models),
            n_submissions=len(team.submissions),
            # Every team here is one the caller is in, and its members are already
            # loaded for the count — so their role is in hand, no second query.
            role=next(
                (member.role for member in team.members if member.user_id == user.id),
                None,
            ),
        )
        for team in teams
    ]


@router.patch("/me", response_model=UserDetail)
async def update_me(
    body: UserUpdate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> UserDetail:
    """Update the authenticated user's name and/or affiliation.

    Raises: 422 - Unprocessable Entity if the body carries a field that is not the
    caller's to set — ``email`` and ``provider`` come from the identity provider.
    """

    updates = body.model_dump(exclude_unset=True)

    for field, value in updates.items():
        setattr(user, field, value)

    await session.commit()
    await session.refresh(user)
    return UserDetail.model_validate(user)
