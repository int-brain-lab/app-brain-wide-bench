"""Celery validation task — glue only.

Orchestrates S3 I/O and DB writes; every check is delegated to
:func:`app.validation.validate_submission.validate_folder`.
"""

import asyncio
import logging
import tempfile
import uuid
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select

from app.config import settings
from app.database import async_session_factory
from app.models import Submission, SubmissionStatus, TaskSuite
from app.scoring import BaseScorer
from app.storage import (
    delete_submission_file,
    download_ground_truth,
    download_submission,
    is_stubbed,
)
from app.validation.validate_submission import ValidationResult, validate_folder
from app.worker import celery_app

logger = logging.getLogger(__name__)

# Beyond this many findings of one code, only the count is kept.
MAX_CODES_PER_KIND = 20


# ── Documents ──────────────────────────────────────────────────────────────────────────────────


def _validation_document(result: ValidationResult, is_deterministic: bool) -> dict:
    """Build the ``Submission.validation`` payload from a validation run.

    Findings are capped per code: one bad tensor across 500 files is 500 findings, and
    neither the column nor the form has any use for more than a sample. ``omitted`` counts
    what the cap dropped.

    ``Finding.detail`` is never included — it can reveal ground-truth structure.
    """
    codes: list[dict] = []
    omitted: dict[str, int] = {}
    per_code: Counter = Counter()

    for finding in result.errors:
        per_code[finding.code] += 1

        if per_code[finding.code] <= MAX_CODES_PER_KIND:
            codes.append({"code": finding.code, "path": finding.path})
        else:
            omitted[finding.code] = per_code[finding.code] - MAX_CODES_PER_KIND

    return {
        "codes": codes,
        "omitted": omitted,
        "tasks": sorted({task for task, _ in result.coverage}),
        "deterministic": is_deterministic,
        "n_files": len(result.pred_entries),
        "finished_at": datetime.now(UTC).isoformat(),
    }


def _internal_error_document(is_deterministic: bool) -> dict:
    """The payload for a validation that could not be run to a verdict.

    Keeps the shape of a real one so a reader needs no special case; ``E999`` maps to the
    generic submitter-facing message, which is all there is to say about our own failure.
    """
    return {
        "codes": [{"code": "E999", "path": "."}],
        "omitted": {},
        "tasks": [],
        "deterministic": is_deterministic,
        "n_files": 0,
        "finished_at": datetime.now(UTC).isoformat(),
    }


# ── Database ───────────────────────────────────────────────────────────────────────────────────


async def _start_validation(submission_id: uuid.UUID) -> tuple[str, bool] | None:
    """Set status to ``validating``; return ``(s3_key, is_deterministic)``.

    ``is_deterministic`` is read here rather than passed in, so the run records the value
    that was current when it started — a later flip is what re-validation is for.

    ``None`` when the submission is gone: a delete racing this task is a submitter
    abandoning their submission, and the outcome they asked for is that nothing is checked.
    """
    async with async_session_factory() as session:
        submission = (
            await session.execute(select(Submission).where(Submission.id == submission_id))
        ).scalar_one_or_none()

        if submission is None:
            return None

        submission.status = SubmissionStatus.validating
        s3_key = submission.s3_key
        is_deterministic = submission.is_deterministic

        await session.commit()

    return s3_key, is_deterministic


async def _finish_validation(
    submission_id: uuid.UUID, status: SubmissionStatus, validation: dict
) -> bool:
    """Persist the verdict and its document. ``False`` when the submission is gone.

    A delete racing this task takes the verdict with it: there is no row to record it on,
    and the file it describes has been released already.
    """
    async with async_session_factory() as session:
        submission = (
            await session.execute(select(Submission).where(Submission.id == submission_id))
        ).scalar_one_or_none()

        if submission is None:
            return False

        submission.status = status
        submission.validation = validation

        await session.commit()

    return True


# ── Task ───────────────────────────────────────────────────────────────────────────────────────


def _suites_in(pred_dir: Path) -> set[str]:
    """Suites named by the task directories in an extracted submission.

    Validation runs before a submission has task rows, so the tree is the only thing that
    says which ground truth to fetch. Task directories sit at depth 2 —
    ``<label>/<task>/…`` — so one glob answers it without opening a file.

    Intersected with the known suites: a malformed tree must not send the download after
    prefixes that do not exist, and validation reports those paths anyway.
    """
    named = {path.name.split("-")[0] for path in pred_dir.glob("*/*") if path.is_dir()}
    return named & {suite.value for suite in TaskSuite}


def _materialise(s3_key: str, tmpdir: Path) -> Path:
    """Return the prediction root for ``s3_key``, downloading and extracting if needed.

    Two local paths come before the download. A key naming a directory is used in place,
    which is how the baseline submissions loaded from a fixture are validated. And
    with no object store there was no upload to read back, so ``stub_submission_dir`` stands
    in for it — every transition and the whole validator still run, over a submission the
    developer put there rather than the one the form chose.

    Raises
    ------
    FileNotFoundError
        Stubbed with no readable ``stub_submission_dir``, which leaves nothing to check.
        Raised rather than returned so the submission lands ``unchecked``: a mode that
        cannot look at anything must not report a file as invalid.
    """
    local = Path(s3_key)
    if local.is_dir():
        return local

    if is_stubbed():
        stub = Path(settings.stub_submission_dir) if settings.stub_submission_dir else None

        if stub is None or not stub.is_dir():
            raise FileNotFoundError(
                f"No object store, and stub_submission_dir is not a directory: "
                f"{settings.stub_submission_dir!r}"
            )

        return stub

    zip_path = download_submission(s3_key, tmpdir.joinpath("submission.zip"))
    return BaseScorer.extract(zip_path, tmpdir.joinpath("pred"))


@celery_app.task(name="validate_submission")
def validate_submission(submission_id: str) -> str:
    """Validate a submission's uploaded file and record the outcome.

    A file that fails is deleted from S3: it will not be scored, and the submitter has to
    upload a corrected one. A run that cannot reach a verdict at all leaves the submission
    ``unchecked`` and the file alone, so it can be checked again once the cause is fixed.

    Parameters
    ----------
    submission_id : str
        UUID of the submission whose file has finished uploading.

    Returns
    -------
    str
        Final status: ``"pending"`` when the file passed, ``"invalid"`` when it did not, or
        ``"gone"`` when the submission was deleted before or during the run. A check that
        could not be run leaves ``unchecked`` and raises.
    """
    sid = uuid.UUID(submission_id)
    started = asyncio.run(_start_validation(sid))

    if started is None:
        return "gone"

    s3_key, is_deterministic = started

    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)

        try:
            pred_dir = _materialise(s3_key, tmpdir)
            gt_dir = download_ground_truth(_suites_in(pred_dir), tmpdir.joinpath("gt"))

            result = validate_folder(
                pred_dir,
                gt_dir,
                settings.min_dataset_version or None,
                settings.max_dataset_version or None,
                is_deterministic,
            )
        except Exception:
            logger.exception("could not validate submission %s", sid)

            # A submission deleted mid-run is what failed the read that landed here, so there
            # is nothing left to report it on.
            if not asyncio.run(
                _finish_validation(
                    sid, SubmissionStatus.unchecked, _internal_error_document(is_deterministic)
                )
            ):
                return "gone"

            raise

        # The only place details are recorded. Never the document, never the response.
        for finding in result.errors:
            logger.warning("%s %s %s: %s", sid, finding.code, finding.path, finding.detail)

        document = _validation_document(result, is_deterministic)
        verdict = SubmissionStatus.pending if result.ok else SubmissionStatus.invalid

        if not asyncio.run(_finish_validation(sid, verdict, document)):
            return "gone"

        if verdict is SubmissionStatus.invalid:
            delete_submission_file(s3_key)

        return verdict.value
