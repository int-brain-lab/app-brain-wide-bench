"""Load a flat JSON fixture into an async SQLAlchemy session.

``model_validate`` on each row handles UUID coercion, enum names, and nulls —
no custom mapping needed because SQLModel classes are Pydantic models.

Usage::

    await load_fixture(session, Path("tests/fixtures/ts1_baseline.json"))
"""

import json
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Model,
    Submission,
    SubmissionUser,
    Task,
    TaskScore,
    TaskSubmission,
    TaskSuite,
    TaskType,
    Team,
    User,
)

# Insertion order respects FK dependencies.
_TABLE_MAP = [
    ("teams",            Team),
    ("users",            User),
    ("models",           Model),
    ("submissions",      Submission),
    ("submission_users", SubmissionUser),
    ("task_submissions", TaskSubmission),
    ("task_scores",      TaskScore),
]

# Mirror of the Alembic migration seed — tests use create_all, not migrations.
# Plain dicts (not Task instances): SQLAlchemy marks committed ORM objects as
# detached once their session closes, so reusing the same instances across
# tests' separate engines silently skips the INSERT on every call after the first.
_TASK_ROWS = [
    dict(id="ts1-choice",                task_suite=TaskSuite.ts1, task_type=TaskType.categorical,   primary_metric="bacc"),
    dict(id="ts1-reward",                task_suite=TaskSuite.ts1, task_type=TaskType.categorical,   primary_metric="bacc"),
    dict(id="ts1-stimulus_contrast",     task_suite=TaskSuite.ts1, task_type=TaskType.categorical,   primary_metric="bacc"),
    dict(id="ts1-licking_rate",          task_suite=TaskSuite.ts1, task_type=TaskType.point_process, primary_metric="cohens_r2"),
    dict(id="ts1-whisker_motion_energy", task_suite=TaskSuite.ts1, task_type=TaskType.continuous,    primary_metric="r2"),
    dict(id="ts1-wheel_speed",           task_suite=TaskSuite.ts1, task_type=TaskType.continuous,    primary_metric="r2"),
    dict(id="ts1-right_paw_speed",       task_suite=TaskSuite.ts1, task_type=TaskType.continuous,    primary_metric="r2"),
    dict(id="ts1-left_paw_speed",        task_suite=TaskSuite.ts1, task_type=TaskType.continuous,    primary_metric="r2"),
    dict(id="ts2-co_smoothing",          task_suite=TaskSuite.ts2, task_type=TaskType.firing_rate,   primary_metric="d2"),
    dict(id="ts2-forecasting",           task_suite=TaskSuite.ts2, task_type=TaskType.firing_rate,   primary_metric="d2"),
    dict(id="ts3-cosmos",                task_suite=TaskSuite.ts3, task_type=TaskType.brain_region,  primary_metric="f1_macro"),
]


async def seed_tasks(session: AsyncSession) -> None:
    """Populate the static task lookup table (replaces the Alembic seed in tests)."""
    for row in _TASK_ROWS:
        session.add(Task(**row))
    await session.commit()


async def load_fixture(session: AsyncSession, path: Path) -> None:
    """Insert all rows from a flat JSON fixture, flushing between tables for FK safety."""
    data = json.loads(Path(path).read_text())
    for key, cls in _TABLE_MAP:
        for row in data.get(key, []):
            session.add(cls.model_validate(row))
        await session.flush()
    await session.commit()