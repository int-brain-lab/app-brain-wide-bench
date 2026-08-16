"""User response and update schemas."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class UserBase(BaseModel):
    """Fields common to user requests and responses.

    A base, not a response: nothing returns it directly. ``UserUpdate`` is the subset a
    caller may change and ``UserDetail`` the whole record.
    """

    email: str
    name: str | None = None
    affiliation: str | None = None


class UserResponse(BaseModel):
    """List item for ``GET /api/users?q=``.

    Only what a member picker needs. Deliberately not built on ``UserBase``: a search hit
    is somebody else's record, and ``affiliation`` is not part of finding them.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str | None = None
    email: str


class UserDetail(UserBase):
    """The caller's own record, for ``GET /api/users/me``."""

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
