"""Tests for the Celery validation task.

The task is sync and drives its own event loops with ``asyncio.run``, so these tests are
sync too, against a file-backed SQLite engine with ``NullPool``: each of the task's loops
opens its own connection, which an in-memory database or a pooled one could not survive.

Only ground truth is mocked. The submission's own file is reached through the
local-directory branch of ``_materialise`` — ``s3_key`` naming a directory is how a
submission made with no object store validates — so download and extraction are the real
code path rather than a stub.
"""

import asyncio
import uuid

import pytest
import torch
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
from sqlmodel import SQLModel

import app.models  # noqa: F401 — register tables on SQLModel.metadata
import app.tasks.validate as validate_task
from app.models import Model, Submission, SubmissionStatus, Team
from app.tasks.validate import MAX_CODES_PER_KIND, validate_submission
from tests.fixtures.submissions import TASK, write_submission

TEAM = uuid.uuid4()
MODEL = uuid.uuid4()


@pytest.fixture
def factory(tmp_path, monkeypatch):
    """A session factory the task can use across separate event loops."""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'task.db'}", poolclass=NullPool)
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    async def create_schema():
        async with engine.begin() as connection:
            await connection.run_sync(SQLModel.metadata.create_all)

    asyncio.run(create_schema())
    monkeypatch.setattr(validate_task, "async_session_factory", sessions)

    return sessions


@pytest.fixture
def submission(factory):
    """Return ``add(**fields) -> submission_id``, for a submission of one throwaway model."""

    def _add(**fields):
        submission_id = uuid.uuid4()

        async def write():
            async with factory() as session:
                session.add(Team(id=TEAM, name="t"))
                session.add(Model(id=MODEL, team_id=TEAM, name="m"))
                session.add(
                    Submission(
                        id=submission_id,
                        model_id=MODEL,
                        label="run",
                        status=SubmissionStatus.validating,
                        **fields,
                    )
                )
                await session.commit()

        asyncio.run(write())

        return submission_id

    return _add


def read(factory, submission_id) -> Submission:
    """The submission as the task left it."""

    async def _read():
        async with factory() as session:
            return await session.get(Submission, submission_id)

    return asyncio.run(_read())


def use_ground_truth(monkeypatch, gt_dir):
    """Point the task's ground-truth download at an existing tree."""
    monkeypatch.setattr(validate_task, "download_ground_truth", lambda suites, dest: gt_dir)


def record_deletes(monkeypatch) -> list[str]:
    """Capture the keys the task deletes instead of removing anything."""
    deleted: list[str] = []
    monkeypatch.setattr(validate_task, "delete_submission", lambda key: deleted.append(key))

    return deleted


# ── Verdicts ──────────────────────────────────────────────────────────────────


def test_a_valid_submission_becomes_pending(tmp_path, monkeypatch, factory, submission):
    """A file that passes leaves the submission ready to submit, and stays in S3."""
    pred_dir, gt_dir = write_submission(tmp_path)
    use_ground_truth(monkeypatch, gt_dir)
    deleted = record_deletes(monkeypatch)

    submission_id = submission(s3_key=str(pred_dir))

    assert validate_submission(str(submission_id)) == "pending"

    row = read(factory, submission_id)

    assert row.status == SubmissionStatus.pending
    assert row.validation["codes"] == []
    assert row.validation["tasks"] == [TASK]
    assert row.validation["n_files"] == 3
    assert row.validation["deterministic"] is False
    assert row.validation["finished_at"]
    assert deleted == []


def test_an_invalid_submission_is_rejected_and_its_file_deleted(
    tmp_path, monkeypatch, factory, submission
):
    """A file that fails is not kept: it will not be scored, and a corrected one replaces it."""
    pred_dir, gt_dir = write_submission(tmp_path, metadata={"unit_filtering": None})
    use_ground_truth(monkeypatch, gt_dir)
    deleted = record_deletes(monkeypatch)

    submission_id = submission(s3_key=str(pred_dir))

    assert validate_submission(str(submission_id)) == "invalid"

    row = read(factory, submission_id)

    assert row.status == SubmissionStatus.invalid
    assert {code["code"] for code in row.validation["codes"]} == {"E001"}
    assert deleted == [str(pred_dir)]


def test_the_declared_determinism_is_the_one_the_run_used(
    tmp_path, monkeypatch, factory, submission
):
    """A single seed passes only because the row claimed determinism, and the run records it."""
    pred_dir, gt_dir = write_submission(tmp_path, seeds=(1,))
    use_ground_truth(monkeypatch, gt_dir)
    record_deletes(monkeypatch)

    submission_id = submission(s3_key=str(pred_dir), is_deterministic=True)

    assert validate_submission(str(submission_id)) == "pending"

    assert read(factory, submission_id).validation["deterministic"] is True


# ── The document ──────────────────────────────────────────────────────────────


def test_findings_are_capped_per_code(tmp_path, monkeypatch, factory, submission):
    """One bad tensor across many files is many findings; the column keeps a sample."""
    predictions = torch.zeros(4, 1, 2)
    predictions[0, 0, 0] = float("inf")

    seeds = tuple(range(1, MAX_CODES_PER_KIND + 6))
    pred_dir, gt_dir = write_submission(tmp_path, seeds=seeds, predictions=predictions)
    use_ground_truth(monkeypatch, gt_dir)
    record_deletes(monkeypatch)

    submission_id = submission(s3_key=str(pred_dir))

    assert validate_submission(str(submission_id)) == "invalid"

    document = read(factory, submission_id).validation

    assert len(document["codes"]) == MAX_CODES_PER_KIND
    assert document["omitted"] == {"E107": 5}
    assert document["n_files"] == len(seeds)


def test_no_internal_detail_reaches_the_document(tmp_path, monkeypatch, factory, submission):
    """``Finding.detail`` can reveal ground-truth structure and goes only to the log."""
    pred_dir, gt_dir = write_submission(tmp_path, gt_trial_ids=[7, 8, 9, 10])
    use_ground_truth(monkeypatch, gt_dir)
    record_deletes(monkeypatch)

    submission_id = submission(s3_key=str(pred_dir))
    validate_submission(str(submission_id))

    document = read(factory, submission_id).validation

    assert {code["code"] for code in document["codes"]} == {"E012"}
    assert all(set(code) == {"code", "path"} for code in document["codes"])


# ── When it cannot reach a verdict ────────────────────────────────────────────


def test_a_failure_to_run_keeps_the_file(tmp_path, monkeypatch, factory, submission):
    """Ours to fix, not the submitter's: the object survives so it can be re-validated."""
    pred_dir, _ = write_submission(tmp_path)

    def unavailable(suites, dest):
        raise OSError("ground truth unreachable")

    monkeypatch.setattr(validate_task, "download_ground_truth", unavailable)
    deleted = record_deletes(monkeypatch)

    submission_id = submission(s3_key=str(pred_dir))

    with pytest.raises(OSError):
        validate_submission(str(submission_id))

    row = read(factory, submission_id)

    assert row.status == SubmissionStatus.invalid
    assert [code["code"] for code in row.validation["codes"]] == ["E999"]
    assert deleted == []
