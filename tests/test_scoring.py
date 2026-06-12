"""Unit tests for the pure scoring module.

Run against local fixture data — no S3, no DB, no mocking. Tests that need the
ground-truth oracle are skipped when the local GT directory is absent, so CI passes
without the full dataset.
"""

import math
from pathlib import Path

import pytest

from app.scoring import get_scorer
from app.scoring.ts1 import TS1Scorer

FIXTURE_ZIP = Path(__file__).parent.joinpath("fixtures", "sample.zip")
GT_DIR = Path.home().joinpath("Documents", "datadisk", "brain-wide-bench", "ts1")

requires_gt = pytest.mark.skipif(not GT_DIR.is_dir(), reason=f"GT dir not found: {GT_DIR}")


def test_extract(tmp_path):
    """A valid zip extracts to a tree containing prediction files."""
    scorer = TS1Scorer()
    pred_dir = scorer.extract(FIXTURE_ZIP, tmp_path)
    assert pred_dir == tmp_path
    assert list(pred_dir.rglob("seed_*.safetensors"))


def test_extract_invalid(tmp_path):
    """A non-zip file raises a clear ValueError."""
    bogus = tmp_path.joinpath("not_a.zip")
    bogus.write_text("definitely not a zip")
    with pytest.raises(ValueError, match="valid zip"):
        TS1Scorer().extract(bogus, tmp_path.joinpath("out"))


def test_extract_no_predictions(tmp_path):
    """A valid zip without prediction files raises a clear ValueError."""
    import zipfile

    empty = tmp_path.joinpath("empty.zip")
    with zipfile.ZipFile(empty, "w") as zf:
        zf.writestr("readme.txt", "no predictions here")
    with pytest.raises(ValueError, match="no 'seed_"):
        TS1Scorer().extract(empty, tmp_path.joinpath("out"))


@requires_gt
def test_score(tmp_path):
    """Scoring the fixture against local GT yields finite metric values."""
    scorer = TS1Scorer()
    pred_dir = scorer.extract(FIXTURE_ZIP, tmp_path)
    result = scorer.score(pred_dir, GT_DIR)

    assert result["rows"], "expected at least one scored recording"
    assert result["summary"], "expected at least one task summary"

    for row in result["rows"]:
        assert {"label", "task", "recording_id", "metrics"} <= row.keys()
        for metric in row["metrics"].values():
            assert math.isfinite(metric["mean"])
            assert metric["n"] >= 1

    for task_summary in result["summary"].values():
        assert math.isfinite(task_summary["mean"])


@requires_gt
def test_score_missing_gt(tmp_path):
    """Missing GT files are skipped gracefully (empty but valid result)."""
    scorer = TS1Scorer()
    pred_dir = scorer.extract(FIXTURE_ZIP, tmp_path)
    result = scorer.score(pred_dir, tmp_path.joinpath("nonexistent_gt"))
    assert result == {"rows": [], "summary": {}}


def test_get_scorer_unknown_task():
    """An unregistered task raises KeyError."""
    with pytest.raises(KeyError):
        get_scorer("ts99")
