"""Base Pydantic schemas shared across the API."""

from pydantic import BaseModel


class UserBase(BaseModel):
    """Fields common to user requests and responses."""

    email: str
    name: str | None = None
    affiliation: str | None = None


class ScoreResultBase(BaseModel):
    """Base class for per-task score result schemas."""