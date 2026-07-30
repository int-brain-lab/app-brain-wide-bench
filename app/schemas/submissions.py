"""Submission request/response schemas."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator

from app.models import (
    Calibration,
    FinetuningStrategy,
    Modality,
    SupervisionRegime,
    TrainingParadigm,
)


class TaskMethodology(BaseModel):
    """How one task was run — the ``TaskSubmission`` methodology columns.

    Shared by the create, update and read schemas so the five fields are declared
    once. Every field is optional: a submission can be created before its
    methodology is filled in, and a PATCH applies only what the caller sent.
    """

    model_config = ConfigDict(from_attributes=True)

    extra_input_modality: list[Modality] | None = None
    training_paradigm: TrainingParadigm | None = None
    supervision_regime: SupervisionRegime | None = None
    calibration: Calibration | None = None
    finetuning_strategy: list[FinetuningStrategy] | None = None


class TaskSubmissionCreate(TaskMethodology):
    """One task entry within ``POST /api/submissions/presign``."""

    task_id: str  # flat task ID, e.g. "ts1-reward"


class TaskSubmissionUpdate(TaskMethodology):
    """Request body for ``PATCH /api/submissions/{id}/tasks/{task_submission_id}``.

    Applied with ``exclude_unset``, so an omitted field is left as-is while an
    explicit ``null`` clears it — the two are not interchangeable here.
    """


class SubmissionCreate(BaseModel):
    """Request body for ``POST /api/submissions/presign``."""

    team_id: uuid.UUID
    model_id: uuid.UUID
    label: str
    tasks: list[TaskSubmissionCreate]
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


class TaskSubmissionDetail(TaskSubmissionOut, TaskMethodology):
    """Task entry plus its methodology — the submission card's Tasks tab.

    Deliberately separate from ``TaskSubmissionOut``, which is also embedded in a
    model's card (``schemas/models.py``) where the methodology isn't shown; adding
    these five fields there would widen every model-card response for nothing.
    """


class SubmissionResponse(BaseModel):
    """List item for ``GET /api/submissions/``."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    label: str
    status: str
    team_id: uuid.UUID
    model_id: uuid.UUID
    created_at: datetime
    updated_at: datetime | None = None
    is_public: bool
    s3_key: str

    # Safe to include here: both endpoints returning this schema are scoped to
    # the caller's own submissions (owner or collaborator). The public model card
    # embeds ModelSubmissionOut instead, which carries no narratives.
    narrative_public: str | None = None
    narrative_private: str | None = None

    # Flattened from the `team` / `model` relationships, which `from_attributes`
    # can't reach by these names — hence the defaults, which exist only so
    # model_validate() accepts the ORM object. `from_submission` always sets
    # them, and a route that forgets to eager-load the relationships raises
    # MissingGreenlet rather than quietly returning null.
    team_name: str | None = None
    model_name: str | None = None

    @classmethod
    def from_submission(cls, submission) -> "SubmissionResponse":
        """Build from an ORM ``Submission`` with ``team`` and ``model`` loaded.

        Inherited by SubmissionDetail, where ``cls`` picks up ``task_submissions``
        from the same ORM object.
        """
        return cls.model_validate(submission).model_copy(
            update={
                "team_name": submission.team.name,
                "model_name": submission.model.name,
            }
        )


class SubmissionUpdate(BaseModel):
    """Request body for ``PATCH /api/submissions/{id}``.

    Applied with ``exclude_unset``, so an omitted field keeps its value while an
    explicit ``null`` clears it.

    Everything else is intentionally immutable: ``model_id`` and ``team_id``
    because the uploaded zip was scored against that specific model and
    re-pointing it would move its results to another model's name; ``s3_key``
    because it's an opaque storage key that a renamed label must not orphan; and
    ``status`` because the scoring pipeline owns it.

    ``extra="forbid"`` so an attempt to change one of those fails loudly instead
    of being silently dropped.
    """

    model_config = ConfigDict(extra="forbid")

    label: str | None = None
    is_public: bool | None = None
    narrative_public: str | None = None
    narrative_private: str | None = None


class SubmissionDetail(SubmissionResponse):
    """Detail view for ``GET /api/submissions/{id}`` — per-task scores and methodology."""

    task_submissions: list[TaskSubmissionDetail] = []