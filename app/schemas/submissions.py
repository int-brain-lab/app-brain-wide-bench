"""Submission request/response schemas."""

import uuid
from datetime import datetime
from typing import Literal

from app.schemas.base import SubmissionBase
from app.schemas.scoring import TS1ScoreResult
from pydantic import BaseModel, ConfigDict


class SubmissionCreate(SubmissionBase):
    """Request body for ``POST /api/submissions/presign``."""

    task: Literal["ts1"]


class PresignResponse(BaseModel):
    """Response from ``POST /api/submissions/presign``."""

    submission_id: uuid.UUID
    upload_url: str
    s3_key: str


class SubmissionResponse(SubmissionBase):
    """List item for ``GET /api/submissions/``."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    task: str
    status: str
    created_at: datetime


class SubmissionDetail(SubmissionResponse):
    """Detail view for ``GET /api/submissions/{id}`` with typed score results."""

    score_results: TS1ScoreResult | None = None
