"""submission upload + validation state

Adds ``upload_id``, ``file_size``, ``validation``, and the three statuses preceding
``pending``. See ``docs/submission_validation_plan_todo.md``.

``--autogenerate`` does not detect enum value additions, and ``compare_metadata`` in
``tests/test_migrations.py`` does not compare enum members — the ``ALTER TYPE`` calls below
are hand-written and unguarded by that test.

Each value is added ``BEFORE 'pending'``; applying them in reverse lands them in lifecycle
order. Postgres permits this inside a transaction while the new values go unused.

Revision ID: 0002_submission_upload_validation
Revises: 0001_initial
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
import sqlmodel

revision: str = '0002_submission_upload_validation'
down_revision: str | None = '0001_initial'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Reverse order: each lands immediately before 'pending'.
    for value in ('invalid', 'validating', 'uploading'):
        op.execute(f"alter type submissionstatus add value if not exists '{value}' before 'pending'")

    op.add_column(
        'submissions',
        sa.Column('upload_id', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    )
    op.add_column('submissions', sa.Column('file_size', sa.BigInteger(), nullable=True))
    op.add_column('submissions', sa.Column('validation', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('submissions', 'validation')
    op.drop_column('submissions', 'file_size')
    op.drop_column('submissions', 'upload_id')
    # Postgres has no DROP VALUE, and recreating the type fails against any row holding one.
