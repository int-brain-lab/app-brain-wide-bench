"""Submission request/response schemas."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class SubmissionCreate(BaseModel):
    """Request body for ``POST /api/submissions/presign``."""

    team_id: uuid.UUID
    model_id: uuid.UUID
    label: str
    task_ids: list[str]  # flat task IDs, e.g. ["ts1-reward", "ts1-choice"]
    is_public: bool = False


class PresignResponse(BaseModel):
    """Response from ``POST /api/submissions/presign``."""

    submission_id: uuid.UUID
    upload_url: str
    s3_key: str


class TaskScoreOut(BaseModel):
    """Score payload for one task."""

    model_config = ConfigDict(from_attributes=True)

    n_seeds: int
    primary_metric_mean: float
    primary_metric_sem: float | None = None
    metrics: dict | None = None


class TaskSubmissionOut(BaseModel):
    """Task entry within a submission, with optional score."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    task_id: str
    score: TaskScoreOut | None = None


class SubmissionResponse(BaseModel):
    """List item for ``GET /api/submissions/``."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    label: str
    status: str
    team_id: uuid.UUID
    model_id: uuid.UUID
    created_at: datetime


class SubmissionDetail(SubmissionResponse):
    """Detail view for ``GET /api/submissions/{id}`` — includes per-task scores."""

    task_submissions: list[TaskSubmissionOut] = []