"""user role

Adds ``users.role``, the application-wide role that is orthogonal to team membership.
``admin`` passes every team check in ``app.auth``.

``add_column`` does not create the enum type the way ``create_table`` does, so ``userrole``
is created on its own first and the column then references it with ``create_type=False``.

``server_default`` is what lets the column be ``NOT NULL`` against a table that already has
rows; the ORM has no server default, and ``compare_metadata`` in ``tests/test_migrations.py``
does not compare them.

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


def downgrade() -> None:
    op.drop_column('users', 'role')
    _role().drop(op.get_bind())
