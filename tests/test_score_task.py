"""Tests for the Celery scoring task's database write.

The main rules are:

- The scalar columns are a copy of ``overall``'s entry for the task's primary metric, not
  of whichever metric the scorer happened to list first.
- A task carries one score. Scoring a submission again replaces the row rather than
  colliding with the unique constraint on ``task_submission_id``.
- The replacement is in the transaction that writes the new rows, so a run that fails
  part-way leaves the scores the submission already had.

Sync, against a file-backed SQLite engine with ``NullPool``, as
``tests/test_validate_task.py`` is: each ``asyncio.run`` opens its own connection.
"""

import asyncio
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
from sqlmodel import SQLModel

import app.models  # noqa: F401 — register tables on SQLModel.metadata
import app.tasks.score as score_task
from app.models import Model, Submission, SubmissionStatus, TaskScore, TaskSubmission, Team
from app.tasks.score import _finish_scoring
from tests.fixtures.load import seed_tasks

TEAM = uuid.uuid4()
MODEL = uuid.uuid4()
SUBMISSION = uuid.uuid4()
ENTRY = uuid.uuid4()

TASK = "ts1-choice"  # primary metric bacc, so the f1 below is the one that must not win
TS_LIST = [(ENTRY, TASK)]


def results(bacc: float, f1: float, n: int = 5) -> dict:
    """A scorer result carrying two metrics, in the shape ``to_result`` returns."""
    return {
        "rows": [{"label": "m", "task": TASK, "recording_id": "recA", "metrics": {}}],
        "overall": {
            TASK: {
                "f1": {"mean": f1, "sem": 0.02, "n": n},
                "bacc": {"mean": bacc, "sem": 0.01, "n": n},
            }
        },
    }


@pytest.fixture
def factory(tmp_path, monkeypatch):
    """A session factory the task can use across separate event loops."""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'score.db'}", poolclass=NullPool)
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    async def build():
        async with engine.begin() as connection:
            await connection.run_sync(SQLModel.metadata.create_all)
        async with sessions() as session:
            await seed_tasks(session)
            session.add(Team(id=TEAM, name="t"))
            session.add(Model(id=MODEL, team_id=TEAM, name="m"))
            session.add(
                Submission(
                    id=SUBMISSION,
                    model_id=MODEL,
                    label="run",
                    s3_key="submissions/run.zip",
                    status=SubmissionStatus.scoring,
                )
            )
            session.add(TaskSubmission(id=ENTRY, submission_id=SUBMISSION, task_id=TASK))
            await session.commit()

    asyncio.run(build())
    monkeypatch.setattr(score_task, "async_session_factory", sessions)

    return sessions


def scores(factory) -> list[TaskScore]:
    """Every score row on ``ENTRY``."""

    async def read():
        async with factory() as session:
            rows = await session.execute(
                select(TaskScore).where(TaskScore.task_submission_id == ENTRY)
            )
            return list(rows.scalars())

    return asyncio.run(read())


def test_finish_scoring_copies_the_primary_metric(factory):
    """The scalars come from the task's own primary metric, and ``overall`` is kept whole."""
    asyncio.run(_finish_scoring(SUBMISSION, SubmissionStatus.done, TS_LIST, results(0.8, 0.4)))

    (score,) = scores(factory)

    assert score.primary_metric_mean == 0.8
    assert score.primary_metric_sem == 0.01
    assert score.n_seeds == 5
    assert set(score.metrics["overall"]) == {"bacc", "f1"}
    assert score.metrics["recordings"][0]["task"] == TASK


def test_finish_scoring_replaces_an_existing_score(factory):
    """Scoring a submission again overwrites its scores instead of duplicating them."""
    asyncio.run(_finish_scoring(SUBMISSION, SubmissionStatus.done, TS_LIST, results(0.8, 0.4)))
    asyncio.run(_finish_scoring(SUBMISSION, SubmissionStatus.done, TS_LIST, results(0.9, 0.5, 7)))

    (score,) = scores(factory)

    assert score.primary_metric_mean == 0.9
    assert score.n_seeds == 7


def test_finish_scoring_keeps_the_old_score_when_the_run_fails(factory):
    """``overall`` without the primary metric raises, and the previous score stands."""
    asyncio.run(_finish_scoring(SUBMISSION, SubmissionStatus.done, TS_LIST, results(0.8, 0.4)))

    broken = results(0.9, 0.5)
    del broken["overall"][TASK]["bacc"]

    with pytest.raises(KeyError):
        asyncio.run(_finish_scoring(SUBMISSION, SubmissionStatus.done, TS_LIST, broken))

    (score,) = scores(factory)

    assert score.primary_metric_mean == 0.8


def test_finish_scoring_without_results_writes_no_score(factory):
    """A failed run records the status and leaves the scores alone."""
    assert asyncio.run(_finish_scoring(SUBMISSION, SubmissionStatus.failed, TS_LIST)) is True

    assert scores(factory) == []
