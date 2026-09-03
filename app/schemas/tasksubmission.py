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
    """Score for one task: the figure a table shows, and nothing behind it.

    No ``metrics``. The per-recording breakdown is tens of kilobytes a score, and this
    shape is what every listing nests — a model with ten scored tasks, a dashboard with
    sixty-seven — so carrying it here means sending megabytes of detail for rows nobody has
    opened. It is on ``TaskScoreDetail``, which is asked for one score at a time.
    """

    model_config = ConfigDict(from_attributes=True)

    n_seeds: int
    primary_metric_mean: float
    primary_metric_sem: float | None = None

    primary_metric: Metric


class TaskScoreDetail(TaskScoreOut):
    """A score with the breakdown behind it — one entry per recording, per metric.

    ``{"recordings": [{"recording_id", "label", "metrics": {name: {mean, sem, n}}}]}``, as
    the scorers wrote it. What every per-recording table and plot is drawn from, and the
    reason to ask for a single task submission by id.
    """

    metrics: dict | None = None


class TaskStanding(BaseModel):
    """One task's current result, as a standing reports it.

    ``mean``/``sem`` rather than ``primary_metric_mean``/``_sem``: which metric it is
    belongs to the task, and whatever carries this already says which task it is under.
    ``metric`` is that metric spelled out, so a client showing one task's score can label
    its units without joining the task table to find them.

    The two ids are where the number came from. A standing's scores are each the newest for
    their task, so they need not share a submission — which is exactly why each one has to
    say which submission it is from. They are also what a caller hands back to ask about
    these very entries rather than about whatever is newest by then; see the breakdown
    endpoint in routers/models.py.
    """

    mean: float
    sem: float | None = None
    n_seeds: int
    metric: Metric

    task_submission_id: uuid.UUID
    submission_id: uuid.UUID

    @classmethod
    def from_entry(cls, task_submission) -> "TaskStanding":
        """Build from an ORM ``TaskSubmission`` with a score.

        Not ``model_validate``: the columns are ``primary_metric_mean``/``_sem`` and this
        shape drops the prefix, so the mapping has to be stated.
        """
        score = task_submission.score

        return cls(
            mean=score.primary_metric_mean,
            sem=score.primary_metric_sem,
            n_seeds=score.n_seeds,
            metric=score.primary_metric,
            task_submission_id=task_submission.id,
            submission_id=task_submission.submission_id,
        )


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
    """Detailed task submission information for GET /api/submissions/{id}/tasks/{task_submission_id}``

    The one shape that carries the per-recording breakdown — see TaskScoreDetail.
    """

    score: TaskScoreDetail | None = None


class TaskBreakdown(TaskStanding, TaskMetadata):
    """A task's result and how it was produced, in one row.

    The two halves of what a reader asks of a single model: the score it stands on, and the
    methodology behind that score. Kept as a pair rather than two lookups because they
    describe one entry — the methodology is the entry's, not the task's, and a model that
    re-ran a task a different way has a different answer for each run.
    """

    @classmethod
    def from_entry(cls, task_submission) -> "TaskBreakdown":
        """Build from an ORM ``TaskSubmission`` with a score.

        The methodology half is read off the entry's own columns, by the names
        ``TaskMetadata`` already gives them, so adding a sixth field there is enough. The
        score half is ``TaskStanding``'s, whose mapping has to be stated because the columns
        carry the ``primary_metric_`` prefix this shape drops.
        """
        return cls(
            **{key: getattr(task_submission, key) for key in TaskMetadata.model_fields},
            **TaskStanding.from_entry(task_submission).model_dump(),
        )


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
