"""SQLModel ORM models.

Tables grouped by domain:
    Identity  — Team, User, UserTeam
    Core      — Model, Submission, SubmissionUser
    Tasks     — Task (lookup), TaskSubmission, TaskScore
"""

import enum
import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import Column, DateTime, Enum as SAEnum, Index, JSON, func, select, text
from sqlalchemy.orm import column_property
from sqlmodel import Field, Relationship, SQLModel


# ── Enums ──────────────────────────────────────────────────────────────────────
#
# Grouped by what they describe: who someone is to a record, what state a submission is
# in, what a task measures, and how a model was trained for it.


class TeamRole(str, enum.Enum):
    owner = "owner"
    collaborator = "collaborator"


class SubmissionStatus(str, enum.Enum):
    pending = "pending"
    scoring = "scoring"
    done = "done"
    failed = "failed"


class SubmissionUserRole(str, enum.Enum):
    """A user's relationship to one submission.

    Same members as ``TeamRole`` but a separate axis: team membership decides what you may
    do, this records who made a particular submission.
    """

    owner = "owner"
    collaborator = "collaborator"


class TaskSuite(str, enum.Enum):
    ts1 = "ts1"
    ts2 = "ts2"
    ts3 = "ts3"


class TaskType(str, enum.Enum):
    """Output type — determines which metrics are computed."""

    categorical = "categorical"
    continuous = "continuous"
    point_process = "point_process"
    firing_rate = "firing_rate"
    brain_region = "brain_region"


class Modality(str, enum.Enum):
    anatomy = "anatomy"
    spikes = "spikes"
    behavior = "behavior"
    lfp = "lfp"
    waveforms = "waveforms"


class TrainingParadigm(str, enum.Enum):
    TSS = "TSS"               # Task-Specific Supervised
    TSU = "TSU"               # Task-Specific Unsupervised (pretrained backbone)
    single_session = "single_session"


class SupervisionRegime(str, enum.Enum):
    zero_shot = "zero_shot"
    few_shot = "few_shot"
    full = "full"
    other = "other"


class Calibration(str, enum.Enum):
    inductive = "inductive"       # gradient-free at eval time
    transductive = "transductive"  # requires gradients on eval set


class FinetuningStrategy(str, enum.Enum):
    linear_probe = "linear_probe"
    mlp_probe = "mlp_probe"
    gradual_unfreezing = "gradual_unfreezing"
    full_finetuning = "full_finetuning"
    single_unit = "single_unit"
    multi_unit = "multi_unit"
    other = "other"


class Metric(str, enum.Enum):
    bacc = "bacc"
    poisson_d2 = "poisson_d2"
    d2 = "d2"
    f1_macro = "macro/f1-score"
    r2 = "r2"


# ── Helpers ────────────────────────────────────────────────────────────────────


# These return a ``Field``, not a value — the annotation is ``Any`` rather than the column
# type they configure, which is what they used to claim.


def _uuid() -> Any:
    """Client-generated primary key, so an id exists before the first flush."""
    return Field(default_factory=uuid.uuid4, primary_key=True)


def _ts() -> Any:
    """Server-side ``now()`` timestamp, nullable until first flush."""
    return Field(default=None, sa_column=Column(DateTime(timezone=True), server_default=func.now()))


def _updated_ts() -> Any:
    """Server-side timestamp that also follows every UPDATE."""
    return Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now()),
    )


# ── Identity ───────────────────────────────────────────────────────────────────


class Team(SQLModel, table=True):
    """A lab or group. Owns models and submissions, and decides who may see them."""

    __tablename__ = "teams"

    # Globally unique, unlike a model's name or a submission's label — a team isn't
    # scoped by anything, and its name is how people refer to it. On ``lower(name)`` so
    # the database enforces the same case-insensitive rule ``_check_valid_team_name``
    # does; a plain unique index would let "Brain Wide Bench" and "brain wide bench"
    # coexist in the table while the API refused the second.
    __table_args__ = (Index("uq_teams_lower_name", text("lower(name)"), unique=True),)

    id: uuid.UUID = _uuid()
    name: str

    members: list["UserTeam"] = Relationship(back_populates="team")
    models: list["Model"] = Relationship(back_populates="team")
    submissions: list["Submission"] = Relationship(back_populates="team")


class User(SQLModel, table=True):
    """Researcher authenticated via Auth0 (Google / Microsoft / ORCID)."""

    __tablename__ = "users"

    id: uuid.UUID = _uuid()
    auth0_sub: str = Field(unique=True, index=True)
    email: str
    name: str | None = None
    affiliation: str | None = None
    provider: str
    orcid_id: str | None = Field(default=None, unique=True)
    created_at: datetime | None = _ts()

    teams: list["UserTeam"] = Relationship(back_populates="user")
    submission_links: list["SubmissionUser"] = Relationship(back_populates="user")


class UserTeam(SQLModel, table=True):
    """M2M bridge — User ↔ Team."""

    __tablename__ = "user_teams"

    user_id: uuid.UUID = Field(foreign_key="users.id", primary_key=True)
    team_id: uuid.UUID = Field(foreign_key="teams.id", primary_key=True)
    # Least privilege by default. The two places that create a membership both say
    # which role they mean, so this only governs a row built without one.
    role: TeamRole = Field(default=TeamRole.collaborator)

    user: User | None = Relationship(back_populates="teams")
    team: Team | None = Relationship(back_populates="members")


# ── Core ───────────────────────────────────────────────────────────────────────

class Model(SQLModel, table=True):
    """A model a team submits results for — its description, not its weights."""

    __tablename__ = "models"

    # Unique per team, not globally: two labs may each have an "mlp-baseline". Indexed on
    # ``lower(name)`` so the database enforces the same case-insensitive rule
    # ``_check_valid_model_name`` applies — a plain unique index would let "MLP-Baseline"
    # through here while the API refused it, which is the worse of the two failures.
    __table_args__ = (
        Index("uq_models_team_id_lower_name", "team_id", text("lower(name)"), unique=True),
    )

    id: uuid.UUID = _uuid()
    team_id: uuid.UUID = Field(foreign_key="teams.id")
    name: str
    # External links
    link_project: str | None = None
    link_weights: str | None = None
    link_code: str | None = None
    publication_doi: str | None = None
    # Architecture
    n_parameters: int | None = None
    temporal_context_s: float = 1.0
    # Pretraining — all nullable for single-session baselines
    is_pretrained: bool | None = None
    pretrained_in_modalities: list[Modality] | None = Field(default=None, sa_column=Column(JSON))
    pretrained_out_modalities: list[Modality] | None = Field(default=None, sa_column=Column(JSON))
    pretraining_data: str | None = None
    created_at: datetime | None = _ts()

    team: Team | None = Relationship(back_populates="models")
    submissions: list["Submission"] = Relationship(back_populates="model")


class Submission(SQLModel, table=True):
    """Uploaded prediction zip + scoring state."""

    __tablename__ = "submissions"

    # A label names a *run* of one model, so it is unique per model rather than per team.
    # Case-insensitive, matching ``_check_valid_submission_label``.
    __table_args__ = (
        Index(
            "uq_submissions_model_id_lower_label",
            "model_id",
            text("lower(label)"),
            unique=True,
        ),
    )

    id: uuid.UUID = _uuid()
    team_id: uuid.UUID = Field(foreign_key="teams.id")
    model_id: uuid.UUID = Field(foreign_key="models.id")
    label: str  # human-readable run name, e.g. "mlp-ts1-baseline"
    s3_key: str
    status: SubmissionStatus = Field(default=SubmissionStatus.pending)
    narrative_public: str | None = None
    narrative_private: str | None = None
    is_public: bool = Field(default=False)
    created_at: datetime | None = _ts()
    updated_at: datetime | None = _updated_ts()

    team: Team | None = Relationship(back_populates="submissions")
    model: Model | None = Relationship(back_populates="submissions")
    user_links: list["SubmissionUser"] = Relationship(
        back_populates="submission",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )
    task_submissions: list["TaskSubmission"] = Relationship(
        back_populates="submission",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )


class SubmissionUser(SQLModel, table=True):
    """M2M bridge — Submission ↔ User."""

    __tablename__ = "submission_users"

    submission_id: uuid.UUID = Field(foreign_key="submissions.id", primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="users.id", primary_key=True)
    role: SubmissionUserRole = Field(default=SubmissionUserRole.owner)

    submission: Submission | None = Relationship(back_populates="user_links")
    user: User | None = Relationship(back_populates="submission_links")


# ── Tasks & Scores ─────────────────────────────────────────────────────────────


class Task(SQLModel, table=True):
    """Static lookup of flat task IDs — seeded in migration, never written at runtime.

    Examples: ``ts1-reward``, ``ts1-whisker_motion_energy``, ``ts2-forecasting``.
    """

    __tablename__ = "tasks"

    id: str = Field(primary_key=True)  # e.g. "ts1-reward"
    task_suite: TaskSuite
    task_type: TaskType

    # An enum rather than free text, so a metric name is spelled one way everywhere.
    #
    # ``values_callable`` because SQLAlchemy stores enum *names* by default, and
    # ``Metric.f1_macro`` is the one member whose name and value differ — its value,
    # ``macro/f1-score``, cannot be a Python identifier. The tasks seed in the initial
    # migration inserts by value, so without this the ORM asks the database for a label
    # it has never held and every read of a ts3 task raises ``LookupError``.
    primary_metric: Metric = Field(
        sa_column=Column(
            SAEnum(Metric, name="metric", values_callable=lambda e: [m.value for m in e]),
            nullable=False,
        )
    )

    task_submissions: list["TaskSubmission"] = Relationship(back_populates="task")


class TaskSubmission(SQLModel, table=True):
    """One task entry within a submission — methodology metadata + link to score."""

    __tablename__ = "task_submissions"

    id: uuid.UUID = _uuid()
    submission_id: uuid.UUID = Field(foreign_key="submissions.id")
    task_id: str = Field(foreign_key="tasks.id")
    extra_input_modality: list[Modality] | None = Field(default=None, sa_column=Column(JSON))
    training_paradigm: TrainingParadigm | None = None
    supervision_regime: SupervisionRegime | None = None
    calibration: Calibration | None = None
    finetuning_strategy: list[FinetuningStrategy] | None = Field(default=None, sa_column=Column(JSON))

    submission: Submission | None = Relationship(back_populates="task_submissions")
    task: Task | None = Relationship(back_populates="task_submissions")
    score: Optional["TaskScore"] = Relationship(
        back_populates="task_submission",
        sa_relationship_kwargs={"cascade": "all, delete-orphan", "uselist": False},
    )


class TaskScore(SQLModel, table=True):
    """Mean ± SEM over seeds for one TaskSubmission.

    ``primary_metric_*`` are scalar columns for fast leaderboard ORDER BY;
    all metrics live in ``metrics`` JSON: ``{"r2": {"mean": 0.42, "sem": 0.03}, ...}``.
    """

    __tablename__ = "task_scores"

    id: uuid.UUID = _uuid()
    task_submission_id: uuid.UUID = Field(foreign_key="task_submissions.id", unique=True)
    n_seeds: int
    primary_metric_mean: float
    primary_metric_sem: float | None = None

    metrics: dict | None = Field(default=None, sa_column=Column(JSON, nullable=True))

    task_submission: TaskSubmission | None = Relationship(back_populates="score")


# The metric a score is measured in belongs to the task, two relationships away
# (score -> task_submission -> task). As a column_property it is selected alongside the
# score's own columns, so a score is self-describing wherever it is read and no endpoint
# has to eager-load a path it has no other use for.
#
# Out here because it refers to TaskScore itself. Read-only, and not a real column — there
# is nothing to migrate and writing scores is unaffected.
TaskScore.primary_metric = column_property(
    select(Task.primary_metric)
    .join(TaskSubmission, TaskSubmission.task_id == Task.id)
    .where(TaskSubmission.id == TaskScore.task_submission_id)
    .correlate_except(Task, TaskSubmission)
    .scalar_subquery()
)
