"""initial schema v2

Revision ID: 0001_initial
Revises:
Create Date: 2026-06-25

Hand-authored full migration: 9 tables, 9 enum types, task seed data.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_initial"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Helper: reference a pre-created PG enum type without re-creating it.
# Must be the postgres-dialect ENUM (not the generic sa.Enum): only that class's
# _on_table_create actually honours create_type=False and skips CREATE TYPE.
def _enum(name: str) -> postgresql.ENUM:
    return postgresql.ENUM(name=name, create_type=False)


def upgrade() -> None:
    # ── Enum types ────────────────────────────────────────────────────────────
    op.execute("CREATE TYPE submissionstatus AS ENUM ('pending', 'scoring', 'done', 'failed')")
    op.execute("CREATE TYPE submissionuserrole AS ENUM ('owner', 'collaborator')")
    op.execute("CREATE TYPE tasksuite AS ENUM ('ts1', 'ts2', 'ts3')")
    op.execute(
        "CREATE TYPE tasktype AS ENUM "
        "('categorical', 'continuous', 'point_process', 'firing_rate', 'brain_region')"
    )
    op.execute("CREATE TYPE modality AS ENUM ('anatomy', 'spikes', 'behavior')")
    op.execute("CREATE TYPE trainingparadigm AS ENUM ('TSS', 'TSU', 'single_session')")
    op.execute("CREATE TYPE supervisionregime AS ENUM ('zero_shot', 'few_shot', 'full', 'other')")
    op.execute("CREATE TYPE calibration AS ENUM ('inductive', 'transductive')")
    op.execute(
        "CREATE TYPE finetuningstrategy AS ENUM "
        "('linear_probe', 'mlp_probe', 'gradual_unfreezing', 'full_finetuning', 'other')"
    )

    # ── Tables (FK-safe order) ────────────────────────────────────────────────
    op.create_table(
        "teams",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
    )

    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("auth0_sub", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column("affiliation", sa.String(), nullable=True),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("orcid_id", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("auth0_sub"),
        sa.UniqueConstraint("orcid_id"),
    )
    op.create_index("ix_users_auth0_sub", "users", ["auth0_sub"])

    op.create_table(
        "user_teams",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("team_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["team_id"], ["teams.id"]),
        sa.PrimaryKeyConstraint("user_id", "team_id"),
    )

    op.create_table(
        "models",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("team_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("link_project", sa.String(), nullable=True),
        sa.Column("link_weights", sa.String(), nullable=True),
        sa.Column("link_code", sa.String(), nullable=True),
        sa.Column("publication_doi", sa.String(), nullable=True),
        sa.Column("n_parameters", sa.Integer(), nullable=True),
        sa.Column("temporal_context_s", sa.Float(), nullable=False, server_default="1.0"),
        sa.Column("is_pretrained", sa.Boolean(), nullable=True),
        sa.Column("pretrained_in_modalities", _enum("modality"), nullable=True),
        sa.Column("pretrained_out_modalities", _enum("modality"), nullable=True),
        sa.Column("pretraining_data", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["team_id"], ["teams.id"]),
    )

    op.create_table(
        "submissions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("team_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("model_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("label", sa.String(), nullable=False),
        sa.Column("s3_key", sa.String(), nullable=False),
        sa.Column("status", _enum("submissionstatus"), nullable=False),
        sa.Column("narrative_public", sa.String(), nullable=True),
        sa.Column("narrative_private", sa.String(), nullable=True),
        sa.Column("is_public", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["team_id"], ["teams.id"]),
        sa.ForeignKeyConstraint(["model_id"], ["models.id"]),
    )

    op.create_table(
        "submission_users",
        sa.Column("submission_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role", _enum("submissionuserrole"), nullable=False),
        sa.ForeignKeyConstraint(["submission_id"], ["submissions.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("submission_id", "user_id"),
    )

    op.create_table(
        "tasks",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("task_suite", _enum("tasksuite"), nullable=False),
        sa.Column("task_type", _enum("tasktype"), nullable=False),
        sa.Column("primary_metric", sa.String(), nullable=False),
    )

    op.create_table(
        "task_submissions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("submission_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("task_id", sa.String(), nullable=False),
        sa.Column("extra_input_modality", sa.String(), nullable=True),
        sa.Column("training_paradigm", _enum("trainingparadigm"), nullable=True),
        sa.Column("supervision_regime", _enum("supervisionregime"), nullable=True),
        sa.Column("calibration", _enum("calibration"), nullable=True),
        sa.Column("finetuning_strategy", _enum("finetuningstrategy"), nullable=True),
        sa.ForeignKeyConstraint(["submission_id"], ["submissions.id"]),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"]),
    )

    op.create_table(
        "task_scores",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("task_submission_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("n_seeds", sa.Integer(), nullable=False),
        sa.Column("primary_metric_mean", sa.Float(), nullable=False),
        sa.Column("primary_metric_sem", sa.Float(), nullable=True),
        sa.Column("metrics", sa.JSON(), nullable=True),
        sa.UniqueConstraint("task_submission_id"),
        sa.ForeignKeyConstraint(["task_submission_id"], ["task_submissions.id"]),
    )

    # ── Seed tasks lookup table ───────────────────────────────────────────────
    tasks_tbl = sa.table(
        "tasks",
        sa.column("id", sa.String()),
        sa.column("task_suite", _enum("tasksuite")),
        sa.column("task_type", _enum("tasktype")),
        sa.column("primary_metric", sa.String()),
    )
    op.bulk_insert(tasks_tbl, [
        # ts1 — categorical (balanced accuracy)
        {"id": "ts1-choice",                "task_suite": "ts1", "task_type": "categorical",  "primary_metric": "bacc"},
        {"id": "ts1-reward",                "task_suite": "ts1", "task_type": "categorical",  "primary_metric": "bacc"},
        {"id": "ts1-stimulus_contrast",     "task_suite": "ts1", "task_type": "categorical",  "primary_metric": "bacc"},
        # ts1 — point process (Cohen's D²)
        {"id": "ts1-licking_rate",          "task_suite": "ts1", "task_type": "point_process","primary_metric": "cohens_r2"},
        # ts1 — continuous regression (R²)
        {"id": "ts1-whisker_motion_energy", "task_suite": "ts1", "task_type": "continuous",   "primary_metric": "r2"},
        {"id": "ts1-wheel_speed",           "task_suite": "ts1", "task_type": "continuous",   "primary_metric": "r2"},
        {"id": "ts1-right_paw_speed",       "task_suite": "ts1", "task_type": "continuous",   "primary_metric": "r2"},
        {"id": "ts1-left_paw_speed",        "task_suite": "ts1", "task_type": "continuous",   "primary_metric": "r2"},
        # ts2 — population firing-rate (D²)
        {"id": "ts2-co_smoothing",          "task_suite": "ts2", "task_type": "firing_rate",  "primary_metric": "d2"},
        {"id": "ts2-forecasting",           "task_suite": "ts2", "task_type": "firing_rate",  "primary_metric": "d2"},
        # ts3 — brain region (macro F1)
        {"id": "ts3-cosmos",                "task_suite": "ts3", "task_type": "brain_region", "primary_metric": "f1_macro"},
    ])


def downgrade() -> None:
    op.drop_table("task_scores")
    op.drop_table("task_submissions")
    op.drop_table("tasks")
    op.drop_table("submission_users")
    op.drop_table("submissions")
    op.drop_table("models")
    op.drop_table("user_teams")
    op.drop_index("ix_users_auth0_sub", table_name="users")
    op.drop_table("users")
    op.drop_table("teams")

    op.execute("DROP TYPE IF EXISTS submissionstatus")
    op.execute("DROP TYPE IF EXISTS submissionuserrole")
    op.execute("DROP TYPE IF EXISTS tasksuite")
    op.execute("DROP TYPE IF EXISTS tasktype")
    op.execute("DROP TYPE IF EXISTS modality")
    op.execute("DROP TYPE IF EXISTS trainingparadigm")
    op.execute("DROP TYPE IF EXISTS supervisionregime")
    op.execute("DROP TYPE IF EXISTS calibration")
    op.execute("DROP TYPE IF EXISTS finetuningstrategy")