"""add models.n_parameters_estimated

Whether ``n_parameters`` is an estimate rather than a count. A single-session baseline is
trained per session under a hyperparameter sweep, so the figure it reports is the median over
the models the sweep selected.

NOT NULL defaulting to false: every existing row is a plain count until something says
otherwise. ``server_default`` is what lets the column be NOT NULL against a table that already
has rows; the ORM has no server default, and ``compare_metadata`` in
``tests/test_migrations.py`` does not compare them.

Revision ID: 0005_n_parameters_estimated
Revises: 0004_task_rename_pretrained
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = '0005_n_parameters_estimated'
down_revision: str | None = '0004_task_rename_pretrained'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        'models',
        sa.Column(
            'n_parameters_estimated',
            sa.Boolean(),
            nullable=False,
            server_default=sa.text('false'),
        ),
    )


def downgrade() -> None:
    op.drop_column('models', 'n_parameters_estimated')
