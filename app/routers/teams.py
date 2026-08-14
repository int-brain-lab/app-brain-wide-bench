"""Team endpoints: create, list, detail, rename."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from typing import Any, Sequence

from app.auth import (
    get_current_user,
    get_current_user_optional,
    require_team_member,
    member_team_ids,
)
from app.database import get_session
from app.models import Model, Submission, Team, User, UserTeam
from app.schemas.teams import (
    TeamCreate,
    TeamDetail,
    TeamMemberAdd,
    TeamMemberOut,
    TeamResponse,
    TeamUpdate,
)

from app.routers.models import visible_models
from app.routers.submissions import visible_submissions

router = APIRouter(prefix="/api/teams", tags=["teams"])

# ── Per-team aggregates ──────────────────────────────────────────────────────

async def countable_submissions(
    user: User | None, session: AsyncSession
) -> ColumnElement[bool]:
    """Which submissions this caller may have counted: the public ones, plus every
    submission belonging to a team they're in.

    The same rule ``list_models`` applies to a model's submission count. Without the
    team clause a member would see their own team under-reported; without the public
    clause an anonymous caller would see nothing. Counting everything unconditionally
    would publish how much unreleased work each team has.
    """
    my_team_ids = await member_team_ids(user.id if user else None, session)

    if not my_team_ids:
        return Submission.is_public.is_(True)

    return or_(
        Submission.is_public.is_(True),
        Submission.team_id.in_(list(my_team_ids)),
    )


async def member_count_per_team(session: AsyncSession = Depends(get_session)) -> dict[uuid.UUID, int]:
    """Return the number of members per team, keyed by team id.

    Returns a dict of {team id: nMembers}
    """
    member_rows = await session.execute(
        select(UserTeam.team_id, func.count(UserTeam.user_id))
        .group_by(UserTeam.team_id)
    )

    return dict(member_rows.all())


async def model_count_per_team(visible: ColumnElement[bool], session: AsyncSession = Depends(get_session)) -> dict[uuid.UUID, int]:
    """Return the number of models per team

    Returns a dict of {team id: nModels}
    """
    model_rows = await session.execute(
        select(Model.team_id, func.count(Model.id))
        .where(visible)
        .group_by(Model.team_id)
    )
    return dict(model_rows.all())


async def submission_count_per_team(visible: ColumnElement[bool], session: AsyncSession = Depends(get_session)) -> dict[uuid.UUID, int]:
    """Return the number of submissions per team

    Returns a dict of {team id: nSubmissions}

    Only submissions that match the ``visible`` criteria are considered.
    """
    submission_rows = await session.execute(
        select(Submission.team_id, func.count(Submission.id))
        .where(visible)
        .group_by(Submission.team_id)
    )
    return dict(submission_rows.all())

# ── Helpers ──────────────────────────────────────────────────────

async def _get_team(
    team_id: uuid.UUID,
    session: AsyncSession,
    *,
    options: Sequence[Any] = ()) -> Team:
    """Fetch a team by ``team_id`,  applying any loader ``options``.

    ``options`` is keyword-only, matching the submission helpers — a list passed
    positionally into a ``*options`` varargs used to reach SQLAlchemy as ``([Load],)``
    and fail there rather than here.

    Raises: 404 - Not found if the team doesn't exist
    """

    team = (
        await session.execute(
            select(Team)
            .options(
                selectinload(Team.members).selectinload(UserTeam.user),
                *options
            )
            .where(Team.id == team_id)
        )
    ).scalar_one_or_none()

    if team is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Team not found")

    return team

async def _get_team_as_member(
    team_id: uuid.UUID,
    user_id: uuid.UUID,
    session: AsyncSession,
    *,
    options: Sequence[Any] = ()) -> Team:
    """Fetch a team by ``team_id`, enforcing that ``user_id`` is a member of it.

    Raises: 404 - Not found if the team doesn't exist
    Raises: 403 - Forbidden if the user is not a member of the team
    """

    team = await _get_team(team_id, session, options=options)

    # Check directly rather than using is_team_member as we already have the information loaded.
    is_member = any(member.user_id == user_id for member in team.members)
    if not is_member:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "User is not a member of the team")

    return team


async def _check_valid_team_name(
        name: str,
        session: AsyncSession = Depends(get_session),
        *,
        exclude_id: uuid.UUID | None = None
) -> str:
    """Checks that the team name is unique (case-insensitive) and not blank.

    Raises: 422 - Unprocessable Entity if the name is blank
    Raises: 409 - Conflict if the name is not unique (case-insensitive)
    """
    name = name.strip()
    if not name:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Team name cannot be blank"
        )

    query = select(Team).where(func.lower(Team.name) == name.lower())
    if exclude_id is not None:
        query = query.where(Team.id != exclude_id)

    existing = await session.execute(query)
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"A team named '{name}' already exists"
        )

    return name

async def _load_team_detail(
    team_id: uuid.UUID,
    user: User | None = Depends(get_current_user_optional),
    session: AsyncSession = Depends(get_session)
) -> TeamDetail:
    """Return a team's details including number of members, models and submissions.

    Anonymous viewers and non-team members see only public submissions and models with at least one public submission;
    a member of the team's sees all of them, public or private.

    Only team members are returned the list of members.

    Raises: 404 - Not found if the team doesn't exist
    """

    team = await _get_team(
        team_id,
        session,
        options=[selectinload(Team.models).selectinload(Model.submissions)],
    )

    visible = await visible_submissions(user, session)

    # Scoped to this team as well as to what the caller may see — ``visible`` alone is the
    # whole-database predicate and would count every other team's submissions too.
    n_submissions = (
        await session.execute(
            select(func.count(Submission.id))
            .where(visible, Submission.team_id == team_id)
        )
    ).scalar_one()

    # A member sees every model; anyone else sees only those with a public submission.
    is_member = user is not None and any(member.user_id == user.id for member in team.members)
    if is_member:
        models = team.models
    else:
        models = [
            model for model in team.models
            if any(submission.is_public for submission in model.submissions)
        ]

    return TeamDetail(
        id=team.id,
        name=team.name,
        n_members=len(team.members),
        n_models=len(models),
        n_submissions=n_submissions,
        # None, not [] — see TeamDetail: a non-member is told nothing, which is not the
        # same as being told the team is empty.
        members=(
            [TeamMemberOut.model_validate(member.user) for member in team.members]
            if is_member
            else None
        ),
    )


# ── Endpoints ──────────────────────────────────────────────────────
@router.get("", response_model=list[TeamResponse])
async def list_teams(
        user: User | None = Depends(get_current_user_optional),
        session: AsyncSession = Depends(get_session)) -> list[TeamResponse]:
    """List all teams. Alphabetically ordered.

    Add number of members, models and submsissions to each team.

    An authenticated user sees every model and submission on a team they belong to,
    whether or not it has a public submission. An anonymous user only sees public
    submissions and models with at least one public submission.
    """
    teams = (
        (
            await session.execute(
                select(Team)
                .order_by(Team.name)
            )
        )
        .scalars()
        .all()
    )


    n_members = await member_count_per_team(session)

    visible = await visible_submissions(user, session)
    n_submissions = await submission_count_per_team(visible, session)

    visible = await visible_models(user, session)
    n_models = await model_count_per_team(visible, session)

    return [
        TeamResponse.from_team(
            team,
            n_members=n_members.get(team.id, 0),
            n_models=n_models.get(team.id, 0),
            n_submissions=n_submissions.get(team.id, 0),
        )
        for team in teams
    ]

@router.post("", response_model=TeamDetail, status_code=status.HTTP_201_CREATED)
async def create_team(
    body: TeamCreate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TeamDetail:
    """Create a team

    The creator is automatically added as a member.
    """
    name = await _check_valid_team_name(body.name, session)

    team = Team(name=name)
    session.add(team)
    session.add(UserTeam(user_id=user.id, team_id=team.id))
    await session.commit()


    return await _load_team_detail(team.id, user, session)

@router.get("/{team_id}", response_model=TeamDetail)
async def get_team(
    team_id: uuid.UUID,
    user: User | None = Depends(get_current_user_optional),
    session: AsyncSession = Depends(get_session),
) -> TeamDetail:
    """Get a team by ```team_id```"""
    return await _load_team_detail(team_id, user, session)


@router.patch("/{team_id}", response_model=TeamDetail)
async def update_team(
    team_id: uuid.UUID,
    body: TeamUpdate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TeamDetail:
    """Update a team by ``team_id``.

    Only accessible to members of the team.
    """
    team = await _get_team_as_member(team_id, user.id, session)

    updates = body.model_dump(exclude_unset=True)

    name = updates.pop("name", None)
    if name is not None:
        name = await _check_valid_team_name(name, session, exclude_id=team_id)
        team.name = name

    for field, value in updates.items():
        setattr(team, field, value)


    await session.commit()
    await session.refresh(team)

    return await _load_team_detail(team_id, user, session)


@router.post(
    "/{team_id}/members",
    response_model=TeamMemberOut,
    status_code=status.HTTP_201_CREATED,
)
async def add_team_member(
    team_id: uuid.UUID,
    body: TeamMemberAdd,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> User:
    """Add an existing user to a team by email.

    Only accessible to members of the team.
    """

    await require_team_member(user.id, team_id, session)

    email = body.email.strip()

    new_user = (
        await session.execute(
            select(User)
            .where(func.lower(User.email) == email.lower())
        )
    ).scalar_one_or_none()

    if new_user is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            f"No user with email '{email}'. They must sign in once before being added.",
        )

    # Check they are not already and existing memeber
    existing = (
        await session.execute(
            select(UserTeam)
            .where(
                UserTeam.user_id == new_user.id,
                UserTeam.team_id == team_id
            )
        )
    ).scalar_one_or_none()

    if existing is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"{email} is already a member of this team"
        )

    session.add(UserTeam(user_id=new_user.id, team_id=team_id))
    await session.commit()

    return new_user


@router.delete("/{team_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_team_member(
    team_id: uuid.UUID,
    user_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    """Remove a member from a team.

    Only accessible to members of the team.

    The last remaining member of a team cannot be removed.
    """

    await require_team_member(user.id, team_id, session)

    link = (
        await session.execute(
            select(UserTeam).where(
                UserTeam.user_id == user_id, UserTeam.team_id == team_id
            )
        )
    ).scalar_one_or_none()

    if link is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "That user is not a member of this team"
        )

    n_members = (
        await session.execute(
            select(func.count()).select_from(UserTeam).where(UserTeam.team_id == team_id)
        )
    ).scalar_one()
    if n_members <= 1:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Cannot remove the last member — the team would be left orphaned",
        )

    await session.delete(link)
    await session.commit()
