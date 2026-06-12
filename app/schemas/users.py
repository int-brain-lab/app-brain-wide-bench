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


class UserUpdate(BaseModel):
    """Request body for ``PATCH /api/users/me``."""

    name: str | None = None
    affiliation: str | None = None
