"""initial schema

Generated from ``SQLModel.metadata``, deliberately, and squashed from the three
migrations that preceded it. Those had drifted from the ORM in four columns — the
multi-valued modality and finetuning fields were declared as a scalar enum or varchar
while ``app.models`` mapped them as JSON — which no local database ever revealed,
because ``scripts/load_fixtures.py`` builds its schema from the same metadata rather
than from migrations. Only a migrated database carried the mismatch.

Regenerate rather than hand-patch if the models change again, and check the result with
``alembic.autogenerate.compare_metadata`` against a database built only from here: that
comparison is what catches this class of drift before a deploy does.

Revision ID: 0001_initial
Revises:
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
import sqlmodel
from sqlalchemy.dialects import postgresql


revision: str = '0001_initial'
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _enum(name: str) -> postgresql.ENUM:
    """Reference an enum type that ``create_table`` above has already created."""
    return postgresql.ENUM(name=name, create_type=False)


def upgrade() -> None:
    op.create_table('tasks',
    sa.Column('id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('task_suite', sa.Enum('ts1', 'ts2', 'ts3', name='tasksuite'), nullable=False),
    sa.Column('task_type', sa.Enum('categorical', 'continuous', 'point_process', 'firing_rate', 'brain_region', name='tasktype'), nullable=False),
    sa.Column('primary_metric', sa.Enum('bacc', 'poisson_d2', 'd2', 'macro/f1-score', 'r2', name='metric'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('teams',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('name', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('uq_teams_lower_name', 'teams', [sa.literal_column('lower(name)')], unique=True)
    op.create_table('users',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('auth0_sub', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('email', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('name', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    sa.Column('affiliation', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    sa.Column('provider', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('orcid_id', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('orcid_id')
    )
    op.create_index(op.f('ix_users_auth0_sub'), 'users', ['auth0_sub'], unique=True)
    op.create_table('models',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('team_id', sa.Uuid(), nullable=False),
    sa.Column('name', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('link_project', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    sa.Column('link_weights', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    sa.Column('link_code', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    sa.Column('publication_doi', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    sa.Column('n_parameters', sa.Integer(), nullable=True),
    sa.Column('temporal_context_s', sa.Float(), nullable=False),
    sa.Column('is_pretrained', sa.Boolean(), nullable=True),
    sa.Column('pretrained_in_modalities', sa.JSON(), nullable=True),
    sa.Column('pretrained_out_modalities', sa.JSON(), nullable=True),
    sa.Column('pretraining_data', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['team_id'], ['teams.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('uq_models_team_id_lower_name', 'models', ['team_id', sa.literal_column('lower(name)')], unique=True)
    op.create_table('user_teams',
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('team_id', sa.Uuid(), nullable=False),
    sa.Column('role', sa.Enum('owner', 'collaborator', name='teamrole'), nullable=False),
    sa.ForeignKeyConstraint(['team_id'], ['teams.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('user_id', 'team_id')
    )
    op.create_table('submissions',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('team_id', sa.Uuid(), nullable=False),
    sa.Column('model_id', sa.Uuid(), nullable=False),
    sa.Column('label', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('s3_key', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('status', sa.Enum('pending', 'scoring', 'done', 'failed', name='submissionstatus'), nullable=False),
    sa.Column('narrative_public', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    sa.Column('narrative_private', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    sa.Column('is_public', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['model_id'], ['models.id'], ),
    sa.ForeignKeyConstraint(['team_id'], ['teams.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('uq_submissions_model_id_lower_label', 'submissions', ['model_id', sa.literal_column('lower(label)')], unique=True)
    op.create_table('submission_users',
    sa.Column('submission_id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('role', sa.Enum('owner', 'collaborator', name='submissionuserrole'), nullable=False),
    sa.ForeignKeyConstraint(['submission_id'], ['submissions.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('submission_id', 'user_id')
    )
    op.create_table('task_submissions',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('submission_id', sa.Uuid(), nullable=False),
    sa.Column('task_id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('extra_input_modality', sa.JSON(), nullable=True),
    sa.Column('training_paradigm', sa.Enum('TSS', 'TSU', 'single_session', name='trainingparadigm'), nullable=True),
    sa.Column('supervision_regime', sa.Enum('zero_shot', 'few_shot', 'full', 'other', name='supervisionregime'), nullable=True),
    sa.Column('calibration', sa.Enum('inductive', 'transductive', name='calibration'), nullable=True),
    sa.Column('finetuning_strategy', sa.JSON(), nullable=True),
    sa.ForeignKeyConstraint(['submission_id'], ['submissions.id'], ),
    sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('task_scores',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('task_submission_id', sa.Uuid(), nullable=False),
    sa.Column('n_seeds', sa.Integer(), nullable=False),
    sa.Column('primary_metric_mean', sa.Float(), nullable=False),
    sa.Column('primary_metric_sem', sa.Float(), nullable=True),
    sa.Column('metrics', sa.JSON(), nullable=True),
    sa.ForeignKeyConstraint(['task_submission_id'], ['task_submissions.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('task_submission_id')
    )

    # ── Seed tasks lookup table ───────────────────────────────────────────────
    tasks_tbl = sa.table(
        "tasks",
        sa.column("id", sa.String()),
        sa.column("task_suite", _enum("tasksuite")),
        sa.column("task_type", _enum("tasktype")),
        # ``_enum`` and not ``sa.String``: this column is the enum type from the start
        # here, so a varchar parameter is a DatatypeMismatch rather than an implicit cast.
        sa.column("primary_metric", _enum("metric")),
    )
    op.bulk_insert(tasks_tbl, [
        # ts1 — categorical (balanced accuracy)
        {"id": "ts1-choice",                "task_suite": "ts1", "task_type": "categorical",  "primary_metric": "bacc"},
        {"id": "ts1-reward",                "task_suite": "ts1", "task_type": "categorical",  "primary_metric": "bacc"},
        {"id": "ts1-stimulus_contrast",     "task_suite": "ts1", "task_type": "categorical",  "primary_metric": "bacc"},
        # ts1 — point process (Cohen's D²)
        {"id": "ts1-licking_rate",          "task_suite": "ts1", "task_type": "point_process","primary_metric": "poisson_d2"},
        # ts1 — continuous regression (R²)
        {"id": "ts1-whisker_motion_energy", "task_suite": "ts1", "task_type": "continuous",   "primary_metric": "r2"},
        {"id": "ts1-wheel_speed",           "task_suite": "ts1", "task_type": "continuous",   "primary_metric": "r2"},
        {"id": "ts1-right_paw_speed",       "task_suite": "ts1", "task_type": "continuous",   "primary_metric": "r2"},
        {"id": "ts1-left_paw_speed",        "task_suite": "ts1", "task_type": "continuous",   "primary_metric": "r2"},
        # ts2 — population firing-rate (Poisson deviance R², a.k.a. D²)
        {"id": "ts2-co_smoothing",          "task_suite": "ts2", "task_type": "firing_rate",  "primary_metric": "poisson_d2"},
        {"id": "ts2-forecasting",           "task_suite": "ts2", "task_type": "firing_rate",  "primary_metric": "poisson_d2"},
        # ts3 — brain region (macro F1)
        {"id": "ts3-cosmos",                "task_suite": "ts3", "task_type": "brain_region", "primary_metric": "macro/f1-score"},
    ])


def downgrade() -> None:
    op.drop_table('task_scores')
    op.drop_table('task_submissions')
    op.drop_table('submission_users')
    op.drop_index('uq_submissions_model_id_lower_label', table_name='submissions')
    op.drop_table('submissions')
    op.drop_table('user_teams')
    op.drop_index('uq_models_team_id_lower_name', table_name='models')
    op.drop_table('models')
    op.drop_index(op.f('ix_users_auth0_sub'), table_name='users')
    op.drop_table('users')
    op.drop_index('uq_teams_lower_name', table_name='teams')
    op.drop_table('teams')
    op.drop_table('tasks')
