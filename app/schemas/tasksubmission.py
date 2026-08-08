import uuid

from pydantic import BaseModel, ConfigDict, Field

from app.models import (
    Calibration,
    FinetuningStrategy,
    Modality,
    SupervisionRegime,
    TrainingParadigm,
)

class TaskScoreOut(BaseModel):
    """Score for one task."""

    model_config = ConfigDict(from_attributes=True)

    n_seeds: int
    primary_metric_mean: float
    primary_metric_sem: float | None = None
    metrics: dict | None = None


class TaskSubmissionResponse(BaseModel):
    """Task entry within a submission, with optional score."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    task_id: str
    score: TaskScoreOut | None = None


class TaskMetadata(BaseModel):
    """Training metadata for the task"""

    model_config = ConfigDict(from_attributes=True)

    extra_input_modality: list[Modality] | None = None
    training_paradigm: TrainingParadigm | None = None
    supervision_regime: SupervisionRegime | None = None
    calibration: Calibration | None = None
    finetuning_strategy: list[FinetuningStrategy] | None = None


class TaskSubmissionDetail(TaskSubmissionResponse, TaskMetadata):
     """Detailed task submission information for GET /api/submissions/{id}/tasks/{task_submission_id}``"""


class TaskSubmissionCreate(TaskMetadata):
    """Request body for creating a task submission. Applied with ``POST /api/submissions/presign``."""
    model_config = ConfigDict(extra="forbid")
    task_id: str  # flat task ID, e.g. "ts1-reward"


class TaskSubmissionUpdate(TaskMetadata):
    """Request body for ``PATCH /api/submissions/{id}/tasks/{task_submission_id}``"""
    model_config = ConfigDict(extra="forbid")


class TaskSubmissionBulkUpdate(BaseModel):
    """Request body for ``PATCH /api/submissions/{id}/tasks``.

    The targets are explicit ids rather than a filter (a suite, say): the caller already
    knows exactly which rows it means — a ticked suite, or a set of selected table rows —
    and sending them makes the request self-describing rather than something whose
    meaning depends on the server re-deriving the same set.

    ``updates`` is nested rather than flattened alongside the ids so that "which rows"
    and "what to change" can't be confused, and so it stays exactly TaskSubmissionUpdate
    — ``exclude_unset`` on it still means "only the fields the caller actually sent".
    """

    model_config = ConfigDict(extra="forbid")

    task_submission_ids: list[uuid.UUID] = Field(min_length=1)
    updates: TaskSubmissionUpdate


