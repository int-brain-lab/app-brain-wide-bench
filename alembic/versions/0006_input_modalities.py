"""replace task_submissions.extra_input_modality with input_modalities

The old column held only the modalities beyond an assumed spikes baseline; the new one holds
the full input list, so a model that runs on LFP alone can say so. Every existing row gets
spikes prefixed to whatever it held, a null old value becoming ``["spikes"]``.

The downgrade writes back only the extra modalities, so a row created with an input list that
does not include spikes cannot round-trip — it degrades to whatever it held minus spikes.

Revision ID: 0006_input_modalities
Revises: 0005_n_parameters_estimated
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '0006_input_modalities'
down_revision: str | None = '0005_n_parameters_estimated'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

BACKFILL = sa.text(
    'UPDATE task_submissions '
    "SET input_modalities = COALESCE('[\"spikes\"]'::jsonb || extra_input_modality, '[\"spikes\"]'::jsonb)"
)

RESTORE = sa.text(
    'UPDATE task_submissions '
    'SET extra_input_modality = CASE '
    "WHEN input_modalities = '[\"spikes\"]'::jsonb THEN NULL "
    "ELSE input_modalities - 'spikes' "
    'END'
)


def upgrade() -> None:
    op.add_column(
        'task_submissions',
        sa.Column('input_modalities', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.execute(BACKFILL)
    op.drop_column('task_submissions', 'extra_input_modality')


def downgrade() -> None:
    op.add_column(
        'task_submissions',
        sa.Column('extra_input_modality', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.execute(RESTORE)
    op.drop_column('task_submissions', 'input_modalities')
