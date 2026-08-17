"""team roles, the metric enum, new enum members, and name uniqueness

Revision ID: 0002_roles_metrics_and_uniqueness
Revises: 0001_initial
Create Date: 2026-08-16

Everything the models gained since 0001:

  * ``user_teams.role`` and its ``teamrole`` type — membership now carries a role, and
    only an owner may manage a team's membership.
  * ``tasks.primary_metric`` becomes the ``metric`` enum, so a metric name is spelled one
    way everywhere instead of being free text.
  * Two enums gained members: ``modality`` (lfp, waveforms) and ``finetuningstrategy``
    (single_unit, multi_unit).
  * Case-insensitive uniqueness on team names, model names within a team, and submission
    labels within a model — matching what the API already enforces.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002_roles_metrics_and_uniqueness"
down_revision: str | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _enum(name: str) -> postgresql.ENUM:
    """Reference a pre-created PG enum type without re-creating it."""
    return postgresql.ENUM(name=name, create_type=False)


def upgrade() -> None:
    # ── New enum types ────────────────────────────────────────────────────────
    op.execute("CREATE TYPE teamrole AS ENUM ('owner', 'collaborator')")
    op.execute("CREATE TYPE metric AS ENUM ('bacc', 'poisson_d2', 'd2', 'f1_macro', 'r2')")

    # ── New members on existing enums ─────────────────────────────────────────
    #
    # Postgres can add to an enum but never remove from one, which is why `downgrade`
    # leaves these in place. `IF NOT EXISTS` so a database already carrying them — one
    # built from `SQLModel.metadata.create_all` rather than from migrations — is not a
    # hard error.
    op.execute("ALTER TYPE modality ADD VALUE IF NOT EXISTS 'lfp'")
    op.execute("ALTER TYPE modality ADD VALUE IF NOT EXISTS 'waveforms'")
    op.execute("ALTER TYPE finetuningstrategy ADD VALUE IF NOT EXISTS 'single_unit'")
    op.execute("ALTER TYPE finetuningstrategy ADD VALUE IF NOT EXISTS 'multi_unit'")

    # ── user_teams.role ───────────────────────────────────────────────────────
    #
    # NOT NULL, so existing rows need a value. 'owner' rather than the model's
    # 'collaborator' default: before this column existed every membership was created
    # with the ORM default of the time, which *was* owner — so 'owner' is what those rows
    # already mean, and anything else would silently strip people of access they have.
    #
    # The server default is dropped afterwards: it exists only to fill the backfill, and
    # leaving it would quietly override the application's own least-privilege default for
    # any INSERT that omits the column.
    op.add_column(
        "user_teams",
        sa.Column("role", _enum("teamrole"), nullable=False, server_default="owner"),
    )
    op.alter_column("user_teams", "role", server_default=None)

    # ── tasks.primary_metric: free text -> enum ───────────────────────────────
    #
    # USING, because Postgres will not cast varchar to an enum implicitly. Any row whose
    # value is not a member of `metric` fails here, which is the point: the column is
    # seeded by this migration series and the API, so a stray value is a bug to see, not
    # to coerce away.
    op.execute(
        "ALTER TABLE tasks "
        "ALTER COLUMN primary_metric TYPE metric USING primary_metric::metric"
    )

    # ── Case-insensitive uniqueness ───────────────────────────────────────────
    #
    # Functional indexes rather than plain unique constraints: the API compares these
    # names case-insensitively, and a case-sensitive index would admit a variant the API
    # refuses — a constraint weaker than the rule above it, which is the worse failure.
    op.create_index("uq_teams_lower_name", "teams", [sa.text("lower(name)")], unique=True)
    op.create_index(
        "uq_models_team_id_lower_name",
        "models",
        ["team_id", sa.text("lower(name)")],
        unique=True,
    )
    op.create_index(
        "uq_submissions_model_id_lower_label",
        "submissions",
        ["model_id", sa.text("lower(label)")],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_submissions_model_id_lower_label", table_name="submissions")
    op.drop_index("uq_models_team_id_lower_name", table_name="models")
    op.drop_index("uq_teams_lower_name", table_name="teams")

    op.execute("ALTER TABLE tasks ALTER COLUMN primary_metric TYPE varchar USING primary_metric::text")

    op.drop_column("user_teams", "role")

    op.execute("DROP TYPE IF EXISTS metric")
    op.execute("DROP TYPE IF EXISTS teamrole")

    # The values added to `modality` and `finetuningstrategy` stay: Postgres has no
    # ALTER TYPE ... DROP VALUE, and rewriting the type would mean rebuilding every
    # column that uses it. Harmless — an unused enum member costs nothing.
