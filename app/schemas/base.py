"""Base Pydantic schemas shared across the API."""

from pydantic import BaseModel


class SubmissionBase(BaseModel):
    """Fields common to submission requests and responses."""

    title: str
    description: str = ""
    affiliation: str = ""
    email: str = ""
    doi: str | None = None
    is_public: bool = False


class UserBase(BaseModel):
    """Fields common to user requests and responses."""

    email: str
    name: str | None = None
    affiliation: str | None = None


class ScoreResultBase(BaseModel):
    """Base class for per-task score result schemas."""
