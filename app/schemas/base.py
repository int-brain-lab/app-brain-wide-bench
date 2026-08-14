"""Base Pydantic schemas shared across the API."""

from pydantic import BaseModel


class ScoreResultBase(BaseModel):
    """Base class for per-task score result schemas."""
