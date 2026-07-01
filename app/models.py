"""SQLModel ORM models.

Tables grouped by domain:
    Identity  — Team, User, UserTeam
    Core      — Model, Submission, SubmissionUser
    Tasks     — Task (lookup), TaskSubmission, TaskScore
"""

import enum
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Column, DateTime, JSON, func
from sqlmodel import Field, Relationship, SQLModel


# ── Enums ──────────────────────────────────────────────────────────────────────


class SubmissionStatus(str, enum.Enum):
    pending = "pending"
    scoring = "scoring"
    done = "done"
    failed = "failed"


class SubmissionUserRole(str, enum.Enum):
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
    other = "other"


# ── Helpers ────────────────────────────────────────────────────────────────────


def _uuid() -> uuid.UUID:
    return Field(default_factory=uuid.uuid4, primary_key=True)


def _ts() -> datetime:
    """Server-side ``now()`` timestamp, nullable until first flush."""
    return Field(default=None, sa_column=Column(DateTime(timezone=True), server_default=func.now()))


# ── Identity ───────────────────────────────────────────────────────────────────


class Team(SQLModel, table=True):
    __tablename__ = "teams"

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

    user: User | None = Relationship(back_populates="teams")
    team: Team | None = Relationship(back_populates="members")


# ── Core ───────────────────────────────────────────────────────────────────────


class Model(SQLModel, table=True):
    __tablename__ = "models"

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
    pretrained_in_modalities: Modality | None = None
    pretrained_out_modalities: Modality | None = None
    pretraining_data: str | None = None
    created_at: datetime | None = _ts()

    team: Team | None = Relationship(back_populates="models")
    submissions: list["Submission"] = Relationship(back_populates="model")


class Submission(SQLModel, table=True):
    """Uploaded prediction zip + scoring state."""

    __tablename__ = "submissions"

    id: uuid.UUID = _uuid()
    team_id: uuid.UUID = Field(foreign_key="teams.id")
    model_id: uuid.UUID = Field(foreign_key="models.id")
    label: str  # human-readable run name, e.g. "mlp-ts1-baseline"
    s3_key: str
    status: SubmissionStatus = SubmissionStatus.pending
    narrative_public: str | None = None
    narrative_private: str | None = None
    is_public: bool = False
    created_at: datetime | None = _ts()
    updated_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now()),
    )

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
    role: SubmissionUserRole = SubmissionUserRole.owner

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
    primary_metric: str  # metric name used to rank on the leaderboard

    task_submissions: list["TaskSubmission"] = Relationship(back_populates="task")


class TaskSubmission(SQLModel, table=True):
    """One task entry within a submission — methodology metadata + link to score."""

    __tablename__ = "task_submissions"

    id: uuid.UUID = _uuid()
    submission_id: uuid.UUID = Field(foreign_key="submissions.id")
    task_id: str = Field(foreign_key="tasks.id")
    extra_input_modality: str | None = None
    training_paradigm: TrainingParadigm | None = None
    supervision_regime: SupervisionRegime | None = None
    calibration: Calibration | None = None
    finetuning_strategy: FinetuningStrategy | None = None

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