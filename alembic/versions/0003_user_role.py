"""user role, optional temporal context

Adds ``users.role``, the application-wide role that is orthogonal to team membership.
``admin`` passes every team check in ``app.auth``.

``add_column`` does not create the enum type the way ``create_table`` does, so ``userrole``
is created on its own first and the column then references it with ``create_type=False``.

``server_default`` is what lets the column be ``NOT NULL`` against a table that already has
rows; the ORM has no server default, and ``compare_metadata`` in ``tests/test_migrations.py``
does not compare them.

Also drops ``NOT NULL`` from ``models.temporal_context_s``. The downgrade fills nulls with
``1.0`` before restoring the constraint, so it cannot tell an unreported value from a real one.

Revision ID: 0003_user_role
Revises: 0002_upload_validation
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '0003_user_role'
down_revision: str | None = '0002_upload_validation'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _role() -> postgresql.ENUM:
    """The ``userrole`` type, named but never created by the DDL that references it."""
    return postgresql.ENUM('user', 'admin', name='userrole', create_type=False)


def upgrade() -> None:
    _role().create(op.get_bind(), checkfirst=True)

    op.add_column(
        'users',
        sa.Column('role', _role(), nullable=False, server_default='user'),
    )

    op.alter_column(
        'models', 'temporal_context_s', existing_type=sa.Float(), nullable=True
    )


def downgrade() -> None:
    op.execute(
        sa.text('UPDATE models SET temporal_context_s = 1.0 WHERE temporal_context_s IS NULL')
    )
    op.alter_column(
        'models', 'temporal_context_s', existing_type=sa.Float(), nullable=False
    )

    op.drop_column('users', 'role')
    _role().drop(op.get_bind())
