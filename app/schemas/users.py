"""User response and update schemas."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class UserSearchResult(BaseModel):
    """Response for ``GET /api/users?q=``."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str | None = None
    email: str


class UserResponse(BaseModel):
    """Fields common to user requests and responses."""

    email: str
    name: str | None = None
    affiliation: str | None = None


class UserDetails(UserResponse):
    """Response for ``GET /api/users/me``."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    provider: str
    orcid_id: str | None = None
    created_at: datetime


class UserUpdate(BaseModel):
    """Request body for ``PATCH /api/users/me``."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    affiliation: str | None = None
