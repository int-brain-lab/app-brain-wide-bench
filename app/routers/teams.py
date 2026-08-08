"""Team endpoints: create, list, detail, rename."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import get_current_user, get_current_user_optional, is_team_member
from app.database import get_session
from app.models import Model, Team, User, UserTeam
from app.schemas.teams import (
    TeamCreate,
    TeamDetail,
    TeamMemberAdd,
    TeamMemberOut,
    TeamResponse,
    TeamUpdate,
)

router = APIRouter(prefix="/api/teams", tags=["teams"])


# ── Per-team aggregates ───────────────────────────────────────────────────────
#
# ``TeamResponse`` carries how many members and models a team has. Computed in SQL
# rather than by loading ``Team.members`` and ``Team.models`` per row, which would pull
# every membership and model object back to produce two integers each.
#
# Shared with ``GET /api/users/me/teams`` (app/routers/users.py), the same way
# ``model_stats`` is.
#
# No visibility predicate, unlike model_stats: both counts are already public on
# ``TeamDetail``, which serves anonymous callers.


async def team_stats(
    session: AsyncSession,
) -> tuple[dict[uuid.UUID, int], dict[uuid.UUID, int]]:
    """Return ``(members, models)`` keyed by team id.

    Two statements rather than one join: counting members and models together would
    multiply each count by the other's row count.

    Plain dicts, so a team with no models is simply absent and callers use
    ``.get(id, 0)``.
    """
    member_rows = await session.execute(
        select(UserTeam.team_id, func.count(UserTeam.user_id)).group_by(UserTeam.team_id)
    )
    model_rows = await session.execute(
        select(Model.team_id, func.count(Model.id)).group_by(Model.team_id)
    )

    return dict(member_rows.all()), dict(model_rows.all())


async def _member_team(session: AsyncSession, team_id: uuid.UUID, user: User) -> Team:
    """Fetch a team, enforcing that ``user`` is a member of it.

    404 before 403 deliberately: a team that doesn't exist and one you can't touch
    are different answers, and team ids aren't secret — they're in the list every
    caller can read.
    """
    team = await session.get(Team, team_id)
    if team is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Team not found")
    if not await is_team_member(session, user.id, team_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this team")
    return team


async def _clean_name(session: AsyncSession, name: str, exclude_id: uuid.UUID | None = None) -> str:
    """Normalise and validate a proposed team name.

    The uniqueness check is advisory: ``teams.name`` has no unique index, so two
    concurrent creates could still both land. It's worth doing anyway because
    team_name is displayed as an identifier on the leaderboard and every model
    card, where two identically-named teams are indistinguishable. Adding the
    index would need a migration and a decision about the duplicates already in
    the data.
    """
    name = name.strip()
    if not name:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Team name cannot be blank"
        )

    query = select(Team).where(func.lower(Team.name) == name.lower())
    if exclude_id is not None:
        query = query.where(Team.id != exclude_id)

    if (await session.execute(query)).scalar_one_or_none() is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"A team named '{name}' already exists"
        )

    return name


@router.post("", response_model=TeamDetail, status_code=status.HTTP_201_CREATED)
async def create_team(
    body: TeamCreate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TeamDetail:
    """Create a team, with the creator as its first member.

    The membership row isn't optional bookkeeping: ``team_id`` is how models and
    submissions are authorised (see ``is_team_member``), so a team you aren't in is
    a team you can't create a model on.
    """
    name = await _clean_name(session, body.name)

    # `Team.id` comes from a default_factory, so it's populated before any flush —
    # the membership row can reference it straight away.
    team = Team(name=name)
    session.add(team)
    session.add(UserTeam(user_id=user.id, team_id=team.id))
    await session.commit()

    # The same shape the GET and the rename answer with. The creator is a member by the
    # row added just above, so `members` comes back populated rather than null.
    return await _team_detail(session, team.id, user)


@router.get("", response_model=list[TeamResponse])
async def list_teams(session: AsyncSession = Depends(get_session)) -> list[TeamResponse]:
    """List every team, alphabetically, with its member and model counts.

    No auth: team names are already published by the leaderboard and by every
    model card, so there's nothing here that isn't exposed elsewhere. Who is *in*
    a team is not public — see ``get_team``.
    """
    teams = (await session.execute(select(Team).order_by(Team.name))).scalars().all()

    members, models = await team_stats(session)

    return [
        TeamResponse.from_team(
            team,
            n_members=members.get(team.id, 0),
            n_models=models.get(team.id, 0),
        )
        for team in teams
    ]


async def _team_detail(
    session: AsyncSession, team_id: uuid.UUID, user: User | None
) -> TeamDetail:
    """Load a team as a full ``TeamDetail``.

    Shared by the GET and the rename so a write answers with exactly what a read
    would: counts *and* members. A response that dropped `members` would force every
    caller to merge it onto what it already had, and "field absent" would become
    indistinguishable from "you may not see this".

    The member *list* is included only for a member of the team: names and email
    addresses shouldn't be enumerable by anyone who can guess a team id. The counts
    are safe for everyone.
    """
    team = (
        await session.execute(
            select(Team)
            .options(
                selectinload(Team.members).selectinload(UserTeam.user),
                selectinload(Team.models),
            )
            .where(Team.id == team_id)
        )
    ).scalar_one_or_none()

    if team is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Team not found")

    # Derived from the already-loaded membership rows rather than calling
    # is_team_member, which would be a second round trip for the same answer.
    is_member = user is not None and any(link.user_id == user.id for link in team.members)

    return TeamDetail(
        id=team.id,
        name=team.name,
        n_members=len(team.members),
        n_models=len(team.models),
        members=(
            [TeamMemberOut.model_validate(link.user) for link in team.members]
            if is_member
            else None
        ),
    )


@router.get("/{team_id}", response_model=TeamDetail)
async def get_team(
    team_id: uuid.UUID,
    user: User | None = Depends(get_current_user_optional),
    session: AsyncSession = Depends(get_session),
) -> TeamDetail:
    """Return a team with its member and model counts."""
    return await _team_detail(session, team_id, user)


@router.patch("/{team_id}", response_model=TeamDetail)
async def update_team(
    team_id: uuid.UUID,
    body: TeamUpdate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TeamDetail:
    """Rename a team. Any member may do so.

    There is no team-role concept to check against — ``UserTeam`` is just
    ``(user_id, team_id)``, unlike ``SubmissionUser`` which carries a role — so
    every member has equal authority here. If teams later need owners or admins,
    this is the check to tighten.
    """
    team = await _member_team(session, team_id, user)

    changes = body.model_dump(exclude_unset=True)

    # `name` is non-nullable, so an explicit null means "leave it alone" here
    # rather than "clear it".
    if changes.get("name") is not None:
        team.name = await _clean_name(session, changes["name"], exclude_id=team_id)

    await session.commit()

    # The full detail, not just the renamed row: the caller is a member by definition
    # here, so it can have everything a GET would give it and re-render from one object.
    return await _team_detail(session, team_id, user)


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
    """Add an existing user to a team by email. Any member may do so.

    Same flat authority as renaming: there's no team role to check, so every
    member can grant access to the team's private models and submissions. That's
    the check to tighten if teams ever gain owners.
    """
    await _member_team(session, team_id, user)

    email = body.email.strip()
    invitee = (
        await session.execute(select(User).where(func.lower(User.email) == email.lower()))
    ).scalar_one_or_none()

    # Rows are only created when someone first calls /api/users/me, so a person
    # who has never signed in genuinely has no id to attach. Inviting them would
    # need a pending-invitation record keyed on email, resolved at first login.
    if invitee is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            f"No user with email '{email}'. They must sign in once before being added.",
        )

    # Checked rather than left to the composite primary key, which would surface
    # as an IntegrityError / 500 instead of a usable message.
    existing = (
        await session.execute(
            select(UserTeam).where(
                UserTeam.user_id == invitee.id, UserTeam.team_id == team_id
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"{email} is already a member of this team"
        )

    session.add(UserTeam(user_id=invitee.id, team_id=team_id))
    await session.commit()

    return invitee


@router.delete("/{team_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_team_member(
    team_id: uuid.UUID,
    user_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    """Remove a member from a team. Any member may do so, including themselves.

    Refuses to remove the last one: a team with no members is orphaned — nobody
    can rename it, add to it, or create models on it, while its existing models and
    submissions stay visible on the leaderboard with no one able to manage them.
    """
    await _member_team(session, team_id, user)

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
