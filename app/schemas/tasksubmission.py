import uuid

from pydantic import BaseModel, ConfigDict, Field

from app.models import (
    Calibration,
    FinetuningStrategy,
    Metric,
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

    primary_metric: Metric


class TaskSubmissionOut(BaseModel):
    """A task entry embedded in the submission or model that owns it, with its score."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    task_id: str
    score: TaskScoreOut | None = None


class TaskSubmissionResponse(TaskSubmissionOut):
    """List item for ``GET /api/users/me/task-submissions``.

    A task submission and its score, plus the names of what it belongs to. The other
    task-submission responses are always read *through* a submission, so the context is
    already on the page around them; this one ranges across every submission a user can
    see, and a bare task id and score wouldn't say whose result it is.

    Ids as well as names, because the dashboard's score table links each row back to its
    submission and its model.
    """

    # ``submission_id`` is a column on TaskSubmission, so ``model_validate`` finds it.
    submission_id: uuid.UUID

    # Optional here only because they live on relationships rather than on the ORM object,
    # so ``model_validate`` can't populate them — ``from_task_submission`` fills them in.
    # Same arrangement as ``SubmissionBase.team_name``.
    model_id: uuid.UUID | None = None
    team_id: uuid.UUID | None = None
    submission_name: str | None = None
    model_name: str | None = None
    team_name: str | None = None

    @classmethod
    def from_task_submission(cls, task_submission) -> "TaskSubmissionResponse":
        """Build from an ORM ``TaskSubmission`` with ``submission`` → model → team loaded."""
        submission = task_submission.submission
        return cls.model_validate(task_submission).model_copy(
            update={
                "model_id": submission.model_id,
                "team_id": submission.model.team_id,
                # A submission's human-readable name is its ``label``.
                "submission_name": submission.label,
                "model_name": submission.model.name,
                "team_name": submission.model.team.name,
            }
        )


class TaskMetadata(BaseModel):
    """Training metadata for a task, shared by its requests and its responses.

    No ``model_config``: the response classes bring ``from_attributes`` themselves and the
    request classes bring ``extra="forbid"``, so neither inherits a setting meant for the
    other. Same arrangement as ``ModelMetadata``.
    """

    extra_input_modality: list[Modality] | None = None
    training_paradigm: TrainingParadigm | None = None
    supervision_regime: SupervisionRegime | None = None
    calibration: Calibration | None = None
    finetuning_strategy: list[FinetuningStrategy] | None = None


class TaskSubmissionDetail(TaskSubmissionOut, TaskMetadata):
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
