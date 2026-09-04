"""Team request/response schemas."""

import uuid

from pydantic import BaseModel, ConfigDict

from app.models import TeamRole


class TeamResponse(BaseModel):
    """List item for ``GET /api/teams`` and ``GET /api/users/me/teams``."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    n_members: int = 0
    n_models: int = 0
    n_submissions: int = 0

    # The *caller's* role in this team, not a property of the team — the only role that
    # can be stated without naming whose it is. None when the caller isn't a member, which
    # ``GET /api/teams`` can return and ``/me/teams`` never does.
    role: TeamRole | None = None

    # Whether the caller is a member, which is what makes the team theirs to edit — the
    # same rule PATCH enforces. Implied by ``role`` being set, and stated anyway: this is
    # the one field ``models`` and ``submissions`` carry under the same name, so a client
    # asking "is this mine" asks it the same way of all three.
    #
    # Deciding who is *in* the team is narrower still and stays keyed off ``role``, since
    # the member endpoints require ownership.
    is_mine: bool = False

    @classmethod
    def from_team(cls, team, **extra) -> "TeamResponse":
        """Build from an ORM ``Team`` plus whatever the caller computed about it.

        ``**extra`` rather than a keyword per count, so ``TeamDetail`` builds through here
        too — it adds ``members``, and enumerating every subclass's fields in the base's
        signature is what stopped it doing so before. A field added to either class is
        then passed at the call site, not threaded through this signature as well.
        """
        return cls(id=team.id, name=team.name, **extra)


class TeamCreate(BaseModel):
    """Request body for ``POST /api/teams``."""

    model_config = ConfigDict(extra="forbid")

    name: str


class TeamUpdate(BaseModel):
    """Request body for ``PATCH /api/teams/{id}``."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = None


class TeamMemberOut(BaseModel):
    """A team's member. Shown only to other members — see ``TeamDetail``.

    ``Out`` because it is embedded in ``TeamDetail.members``, like ``TaskScoreOut`` and
    ``SubmissionModelOut``. It is also what ``POST /api/teams/{id}/members`` returns,
    which is the same row seen on its own rather than a second shape.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str | None = None
    email: str
    role: TeamRole

    @classmethod
    def from_member(cls, member) -> "TeamMemberOut":
        """Build from a ``UserTeam`` link with its ``user`` loaded.

        Not ``model_validate(user)``: a membership is the link *and* the user, because
        ``role`` belongs to the link — the same person can own one team and collaborate
        on another, so it isn't a property of them.
        """
        user = member.user

        return cls(id=user.id, name=user.name, email=user.email, role=member.role)


class TeamMemberCreate(BaseModel):
    """Request body for ``POST /api/teams/{id}/members``."""

    model_config = ConfigDict(extra="forbid")

    email: str

    # Defaults to the lesser role: adding someone should not hand them the power to add
    # others unless that is what the caller chose.
    role: TeamRole = TeamRole.collaborator


class TeamMemberUpdate(BaseModel):
    """Request body for ``PATCH /api/teams/{id}/members/{user_id}``."""

    model_config = ConfigDict(extra="forbid")

    role: TeamRole


class TeamDetail(TeamResponse):
    """Detail view for ``GET /api/teams/{id}``.

    Everything but ``members`` is public: the counts are what a team page shows the world,
    and they reveal nothing the leaderboard doesn't. Who is *in* the team is the team's —
    see ``withhold_private``.
    """

    members: list[TeamMemberOut] | None = None

    def withhold_private(self) -> "TeamDetail":
        """Return a copy without the member list, for a reader outside the team.

        ``None``, not ``[]``: "not shown to you" has to stay distinguishable from "this
        team has nobody in it", and the frontend gates on exactly that — a list means
        render the table, null means say who may see it.
        """
        return self.model_copy(update={"members": None})
