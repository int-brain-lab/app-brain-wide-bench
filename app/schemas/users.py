"""User response and update schemas."""

import uuid
from datetime import datetime

from app.schemas.base import UserBase
from pydantic import BaseModel, ConfigDict


class UserResponse(UserBase):
    """Response for ``GET /api/users/me``."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    provider: str
    orcid_id: str | None = None
    created_at: datetime


class UserSearchResult(BaseModel):
    """One match from ``GET /api/users?q=``.

    Deliberately narrow: enough to tell two people apart when picking who to add to a
    team, and nothing more. Affiliation, provider and ORCID stay on ``/me``.

    This endpoint *is* a user-enumeration surface — any signed-in caller can walk the
    directory by querying prefixes. That was a considered trade for making team
    membership usable; it is the reason ``TeamMemberAdd`` no longer needs to insist on
    a known email.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str | None = None
    email: str


class UserUpdate(BaseModel):
    """Request body for ``PATCH /api/users/me``."""

    name: str | None = None
    affiliation: str | None = None
