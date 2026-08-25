"""SQLModel ORM models.

Tables grouped by domain:
    Identity  — Team, User, UserTeam
    Core      — Model, Submission, SubmissionUser
    Tasks     — Task (lookup), TaskSubmission, TaskScore
"""

import enum
import uuid
from datetime import datetime
from typing import Any, ClassVar, Optional

from sqlalchemy import Column, DateTime, Enum as SAEnum, Index, JSON, func, select, text
from sqlalchemy.orm import column_property
from sqlmodel import Field, Relationship, SQLModel


# ── Enums ──────────────────────────────────────────────────────────────────────
#
# Grouped by what they describe: who someone is to a record, what state a submission is
# in, what a task measures, and how a model was trained for it.


class DescribedEnum(str, enum.Enum):
    """A str enum whose members carry the help text shown beside a form control.

    Members are written ``name = value, description``, and the description rides on the
    member itself rather than sitting in a lookup table beside it — one place to read, and
    a member can't be added without one being noticed as missing.

    ``str.__new__`` with ``_value_`` set explicitly is what keeps the tuple from becoming
    the value: a member still compares equal to its own string, ``Modality("spikes")``
    still resolves, and the SQLAlchemy ``Enum`` column and pydantic both see the same
    values they always did.
    """

    def __new__(cls, value: str, description: str = ""):
        member = str.__new__(cls, value)
        member._value_ = value
        member.description = description

        return member


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


class Modality(DescribedEnum):
    anatomy = (
        "anatomy",
        "Brain region labels, assigned per-unit by mapping recording location to a reference "
        "brain atlas.",
    )
    spikes = (
        "spikes",
        "Ephys spike trains (following spike band filter, threshold crossing, spike sorting). "
        "Discrete per-neuron event times, optionally binned into firing-rate estimates.",
    )
    behavior = (
        "behavior",
        "Any behavioral signal relevant to the decision-making task, including task events and "
        "continuous traces from video and pose tracking.",
    )
    lfp = (
        "lfp",
        "Ephys local field potential (following LFP band filter, downsampling). Captures "
        "lower-frequency population-level signals distinct from spike-level activity.",
    )
    waveforms = (
        "waveforms",
        "Ephys spike waveforms (extracellular action potential shape captured in a short window "
        "around each detected spike).",
    )


class TrainingParadigm(DescribedEnum):
    TSS = (
        "TSS",
        "Task-Suite-Supervised (pretraining objective matches the supervision target of this "
        "task).",
    )
    TSU = (
        "TSU",
        "Task-Suite-Unsupervised (pretraining objective was unrelated to the supervision target "
        "of this task).",
    )
    single_session = (
        "single_session",
        "Trained from scratch on each individual session, no pretraining.",
    )


class SupervisionRegime(DescribedEnum):
    zero_shot = (
        "zero_shot",
        "No supervision data from this task is used to adapt the pretrained model to the eval "
        "session.",
    )
    few_shot = (
        "few_shot",
        "A subset of the available supervised data for this task is used to calibrate the "
        "pretrained model.",
    )
    full = (
        "full",
        "All available supervised data for this task is used to calibrate the pretrained model.",
    )
    other = (
        "other",
        "A regime not captured above; please describe it in the private narrative.",
    )


class Calibration(DescribedEnum):
    inductive = (
        "inductive",
        "Model evaluated on this task with no parameter updates needed.",
    )
    transductive = (
        "transductive",
        "Gradients used to update the model on this task, whether supervised directly on this "
        "task or calibrated via another objective.",
    )


class FinetuningStrategy(DescribedEnum):
    linear_probe = (
        "linear_probe",
        "Linear readout trained on frozen pretrained representations.",
    )
    mlp_probe = (
        "mlp_probe",
        "Multi-layer perceptron readout trained on frozen pretrained representations.",
    )
    gradual_unfreezing = (
        "gradual_unfreezing",
        "Layers progressively unfrozen and finetuned over the course of adaptation.",
    )
    full_finetuning = (
        "full_finetuning",
        "All model parameters updated during adaptation to this task.",
    )
    single_unit = (
        "single_unit",
        "TS3 probe fit and evaluated per individual unit.",
    )
    multi_unit = (
        "multi_unit",
        "TS3 probe fit using a consensus across multiple nearby units.",
    )
    other = (
        "other",
        "A strategy not captured above; please describe it in the private narrative.",
    )


class Metric(str, enum.Enum):
    bacc = "bacc"
    poisson_d2 = "poisson_d2"
    d2 = "d2"
    f1_macro = "macro/f1-score"
    r2 = "r2"


# What each task suite asks a model to predict. Domain fact rather than a column: it is
# fixed by what the suites are, and both the submission forms (which modality can't be an
# *extra input* when it is the target) and /api/meta read it. Here so there is one copy —
# it previously lived only in the frontend's task schema.
SUITE_OUTPUT_MODALITY: dict[TaskSuite, Modality] = {
    TaskSuite.ts1: Modality.behavior,
    TaskSuite.ts2: Modality.spikes,
    TaskSuite.ts3: Modality.anatomy,
}


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

    # Help text for the create and edit forms, keyed by field name and served by
    # /api/meta. Here rather than on the response schemas so the wording sits with the
    # column it describes and can't drift from it; ``test_models`` asserts every key is a
    # real field.
    FIELD_DESCRIPTIONS: ClassVar[dict[str, str]] = {
        "link_project": "Link to project homepage.",
        "link_weights": "Link to model weights (e.g. Huggingface).",
        "link_code": "Link to model code (e.g. GitHub).",
        "publication_doi": "DOI of affiliated publication.",
        "n_parameters": "Total number of non-embedding model parameters.",
        "temporal_context_s": (
            "Duration (s) of context window used, including and preceding the target window. "
            "If context length varies across tasks for this model, report the primary/default "
            "value here and note task-specific deviations in the submission narrative."
        ),
        "is_pretrained": (
            "Is this a pretrained foundation model, or trained from scratch on every session?"
        ),
        "pretrained_in_modalities": "If pretrained, which modalities were accepted as input.",
        "pretrained_out_modalities": "If pretrained, which modalities were used for supervision.",
        "pretraining_data": (
            "Describe the corpus of pretraining data used (all sessions, a subset, external "
            "data)."
        ),
    }


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

    # No team of its own: a submission belongs to a model, and the model to a team. A
    # column here would be a second copy of that answer, free to disagree with the first
    # the moment a model is reassigned — so whose submission this is reads through
    # ``model.team_id``, and reassignment carries the submissions by construction.
    model_id: uuid.UUID = Field(foreign_key="models.id")
    label: str  # human-readable run name, e.g. "mlp-ts1-baseline"
    s3_key: str
    status: SubmissionStatus = Field(default=SubmissionStatus.pending)
    narrative_public: str | None = None
    narrative_private: str | None = None
    is_public: bool = Field(default=False)
    created_at: datetime | None = _ts()
    updated_at: datetime | None = _updated_ts()

    model: Model | None = Relationship(back_populates="submissions")
    user_links: list["SubmissionUser"] = Relationship(
        back_populates="submission",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )
    task_submissions: list["TaskSubmission"] = Relationship(
        back_populates="submission",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )

    # See Model.FIELD_DESCRIPTIONS.
    FIELD_DESCRIPTIONS: ClassVar[dict[str, str]] = {
        "label": (
            "Name of this submission, identifying the base model and what distinguishes this "
            "particular variant."
        ),
        "narrative_public": (
            "A narrative describing this submission, which is made public on the leaderboard."
        ),
        "narrative_private": (
            "This is space for writing comments that are kept private, including notes to the "
            "administrators."
        ),
        "is_public": "Is this submission ready to be published on the leaderboard?",
    }


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

    # See Model.FIELD_DESCRIPTIONS.
    FIELD_DESCRIPTIONS: ClassVar[dict[str, str]] = {
        "extra_input_modality": (
            "Does this model require any modalities other than spikes as input for this task? "
            "This necessarily excludes task-related supervision targets within the target window."
        ),
        "training_paradigm": (
            "Which paradigm is used to train this model on this task? Single-session models are "
            "trained from scratch on each session, with no pretraining used. If adapting a "
            "pretrained foundation model, did the pretraining objective match the supervision "
            "target of this task (Task-Suite-Supervised, TSS) or was it unrelated "
            "(Task-Suite-Unsupervised, TSU)? Note: TSS implies the training objective itself was "
            "aligned with this task, not just the modalities used in input and output (e.g., "
            "forecasting, not just spikes-to-spikes). Refer to the BrainWideBench paper for more "
            "details and examples with existing baselines."
        ),
        "supervision_regime": (
            "To what degree is this model supervised on this task? Zero-shot means no supervision "
            "is needed to adapt a pretrained model on the eval session. Few-shot means a subset "
            "of the available supervised data is used to calibrate a pretrained model. Full means "
            "all available supervised data is used to calibrate a pretrained model. Note that "
            "this specifically refers to data pertaining to this task (i.e. supervision data), "
            "not other available data in the dataset. Single-session models implicitly cannot be "
            "used in a zero-shot fashion, though can use few-shot or use full supervision. If "
            "there is another paradigm not listed, please specify in the private description."
        ),
        "calibration": (
            "Are gradients required to update a pretrained model in order to adapt to this task, "
            "whether that adaptation is supervised on this task directly or calibrated via some "
            "other objective (both count as transductive)? Or can it be evaluated on this task "
            "with no updates to the model parameters (inductive)? Note: here, inductive implies "
            "zero-shot since a model that never uses eval data to adapt also does not use "
            "supervision on this task. Single-session models are always transductive, since they "
            "are trained from scratch on the eval session."
        ),
        "finetuning_strategy": (
            "If finetuning was done from a pretrained model, what kind of strategy was used? "
            "Options include linear/MLP probing, gradual unfreezing, full finetuning, etc. For "
            "TS3, was a single-unit or multi-unit probe used? If a strategy not listed here was "
            "used, please select Other and describe it."
        ),
    }


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
