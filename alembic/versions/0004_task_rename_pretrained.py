"""rename the ts3 task id, and make models.is_pretrained NOT NULL

The ts3 rename from ``ts3-cosmos`` to ``ts3-unit_cosmos`` landed in ``0001_initial``'s seed by
editing it in place, which only reaches a database built after it. This carries the databases
already at an earlier head.

``tasks.id`` is the primary key ``task_submissions.task_id`` references, and that foreign key
has no ``ON UPDATE CASCADE``: the new row is inserted, the entries repointed, and the old row
dropped. Scores hang off ``task_submissions.id`` and are untouched. Both directions are no-ops
on a database whose lookup already holds the name they write, and the downgrade renames back
unconditionally — on a database seeded after the rename it undoes a name that one never had.

``models.is_pretrained`` becomes NOT NULL, defaulting to false: a model is pretrained or it is
not, where the pretraining detail beside it stays optional. ``server_default`` is what lets the
column be NOT NULL against a table that already has rows; the ORM has no server default, and
``compare_metadata`` in ``tests/test_migrations.py`` does not compare them. Existing nulls
become false, so the downgrade cannot tell them from a model that answered no.

``Modality.other`` needs no step here — every modality column is JSONB, not an enum type.

Revision ID: 0004_task_rename_pretrained
Revises: 0003_user_role
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = '0004_task_rename_pretrained'
down_revision: str | None = '0003_user_role'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_TASK = 'ts3-cosmos'
NEW_TASK = 'ts3-unit_cosmos'


def _rename_task(old: str, new: str) -> None:
    """Move the lookup row and every task entry pointing at it from ``old`` to ``new``."""
    bind = op.get_bind()
    params = {'old': old, 'new': new}

    bind.execute(
        sa.text(
            'INSERT INTO tasks (id, task_suite, task_type, primary_metric) '
            'SELECT :new, task_suite, task_type, primary_metric FROM tasks WHERE id = :old '
            'ON CONFLICT (id) DO NOTHING'
        ),
        params,
    )
    bind.execute(
        sa.text('UPDATE task_submissions SET task_id = :new WHERE task_id = :old'), params
    )
    bind.execute(sa.text('DELETE FROM tasks WHERE id = :old'), params)


def upgrade() -> None:
    _rename_task(OLD_TASK, NEW_TASK)

    op.execute(sa.text('UPDATE models SET is_pretrained = false WHERE is_pretrained IS NULL'))
    op.alter_column(
        'models',
        'is_pretrained',
        existing_type=sa.Boolean(),
        nullable=False,
        server_default=sa.text('false'),
    )


def downgrade() -> None:
    op.alter_column(
        'models',
        'is_pretrained',
        existing_type=sa.Boolean(),
        nullable=True,
        server_default=None,
    )

    _rename_task(NEW_TASK, OLD_TASK)
