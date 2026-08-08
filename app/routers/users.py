"""User profile endpoints."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import get_current_user, member_team_ids
from app.database import get_session
from app.models import Model, Team, User, UserTeam, Submission, SubmissionUser
from app.schemas import SubmissionResponse
from app.schemas.models import ModelList

# The aggregate queries behind `n_submissions` / `task_suites` live with the router
# that owns each resource, so the /me/* listings here can't drift from GET /api/models
# and GET /api/submissions on how they're computed. Safe to import: neither of those
# modules imports this one back.
from app.routers.models import model_stats
from app.routers.submissions import suites_by_submission
from app.routers.teams import team_stats
from app.schemas.teams import TeamResponse
from app.schemas.users import UserResponse, UserSearchResult, UserUpdate

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("", response_model=list[UserSearchResult])
async def search_users(
    q: str = Query(min_length=2, description="Name or email fragment"),
    limit: int = Query(default=10, ge=1, le=50),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[User]:
    """Look up users by their *exact* name or email, for picking team members.

    Exact, not prefix or substring: a ``LIKE %q%`` lookup would let any signed-in caller
    walk the directory two letters at a time, which is the enumeration surface this
    codebase deliberately avoided before. Requiring the whole string means the caller
    already knows who they're looking for — the same bar ``POST .../members`` has always
    set by taking an email — and the search only saves them retyping it.

    Name is matched as well as email because two people can share a name; both come back
    and the caller picks by email.

    The caller is excluded: they're already a member of any team they create, so
    offering themselves as someone to add is only ever noise.
    """
    needle = q.strip().lower()

    result = await session.execute(
        select(User)
        .where(
            User.id != user.id,
            or_(
                func.lower(User.email) == needle,
                func.lower(User.name) == needle,
            ),
        )
        .order_by(User.name, User.email)
        .limit(limit)
    )

    return list(result.scalars().all())


@router.get("/me", response_model=UserResponse)
async def me(user: User = Depends(get_current_user)) -> User:
    """Return the authenticated user's profile."""
    return user


@router.get("/me/models", response_model=list[ModelList])
async def my_models(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[ModelList]:
    """List models belonging to any team the current user is a member of.

    Only the caller's own models — contrast ``GET /api/models``, which is the
    directory: models with a public submission plus these.

    Because every row here is a model the caller is a member of, ``n_submissions``
    is the full count; there's no public/private split to apply.
    """
    my_team_ids = await member_team_ids(session, user.id)

    result = await session.execute(
        select(Model)
        .options(selectinload(Model.team))
        .join(UserTeam, UserTeam.team_id == Model.team_id)
        .where(UserTeam.user_id == user.id)
        .order_by(Model.created_at.desc())
    )

    # Every submission on one of my teams' models, public or private — no split to
    # apply here, unlike the public directory in ``list_models``.
    #
    # Keyed on the *model's* team rather than ``Submission.team_id`` so that a model
    # reassigned between teams still counts the submissions made under its previous
    # owner: the field is a count of this model's work, not of this team's.
    countable = Submission.model_id.in_(
        select(Model.id).where(Model.team_id.in_(list(my_team_ids)))
    )

    counts, suites = await model_stats(session, countable)

    return [
        ModelList.from_model(
            model,
            n_submissions=counts.get(model.id, 0),
            task_suites=suites.get(model.id, []),
        )
        for model in result.scalars().all()
    ]


@router.get("/me/submissions", response_model=list[SubmissionResponse])
async def my_submissions(
        user: User = Depends(get_current_user),
        session: AsyncSession = Depends(get_session),
) -> list[SubmissionResponse]:
    """List the current user's submissions. Newest first."""

    submissions = (
        (
            await session.execute(
                select(Submission)
                .options(
                    selectinload(Submission.team),
                    selectinload(Submission.model))
                .join(SubmissionUser)
                .where(SubmissionUser.user_id == user.id)
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

@router.get("/me/teams", response_model=list[TeamResponse])
async def my_teams(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[TeamResponse]:
    """List teams the current user is a member of, with their member and model counts."""
    result = await session.execute(
        select(Team).join(UserTeam, UserTeam.team_id == Team.id).where(UserTeam.user_id == user.id)
    )
    teams = result.scalars().all()

    # Counts are over the whole team, not scoped to the caller — they're the same
    # figures GET /api/teams and the team detail page publish.
    members, models = await team_stats(session)

    return [
        TeamResponse.from_team(
            team,
            n_members=members.get(team.id, 0),
            n_models=models.get(team.id, 0),
        )
        for team in teams
    ]


@router.patch("/me", response_model=UserResponse)
async def update_me(
    body: UserUpdate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> User:
    """Update the authenticated user's name and/or affiliation."""
    if body.name is not None:
        user.name = body.name
    if body.affiliation is not None:
        user.affiliation = body.affiliation
    await session.commit()
    await session.refresh(user)
    return user
