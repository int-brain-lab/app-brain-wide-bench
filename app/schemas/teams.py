"""Team request/response schemas."""

import uuid

from pydantic import BaseModel, ConfigDict


class TeamResponse(BaseModel):
    """List item for ``GET /api/teams`` and ``GET /api/users/me/teams``."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    n_members: int = 0
    n_models: int = 0
    n_submissions: int = 0

    @classmethod
    def from_team(cls, team, n_members=0, n_models=0, n_submissions=0) -> "TeamResponse":
        """Build from an ORM ``Team`` plus its counts."""
        return cls(
            id=team.id,
            name=team.name,
            n_members=n_members,
            n_models=n_models,
            n_submissions=n_submissions,
        )


class TeamCreate(BaseModel):
    """Request body for ``POST /api/teams``."""

    name: str


class TeamUpdate(BaseModel):
    """Request body for ``PATCH /api/teams/{id}``."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = None


class TeamMemberOut(BaseModel):
    """A team's member. Shown only to other members — see ``TeamDetail``."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str | None = None
    email: str


class TeamMemberAdd(BaseModel):
    """Request body for ``POST /api/teams/{id}/members``.

    Still by email rather than user id, now that ``GET /api/users?q=`` exists to find
    people: email is the stable identifier a caller can also type from memory, and it
    keeps this endpoint usable without the search. The enumeration concern that
    originally motivated email-only is now carried by that endpoint's own limits —
    authenticated, minimum query length, capped results.
    """

    model_config = ConfigDict(extra="forbid")

    email: str


class TeamDetail(TeamResponse):
    """Detail view for ``GET /api/teams/{id}``.

    ``members`` is ``None`` rather than ``[]`` for a viewer who isn't in the team,
    so "not shown to you" stays distinguishable from "this team has no members".
    The counts are inherited from ``TeamResponse`` and always present: they're what a
    public team page needs, and they reveal nothing the leaderboard doesn't already.
    """

    members: list[TeamMemberOut] | None = None
