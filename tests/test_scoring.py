"""Unit tests for the pure scoring module.

Four layers, deliberately separated:

1. **extract / routing** — format-independent glue in ``BaseScorer`` / ``get_scorer``.
2. **wrapper logic** — each ``*Scorer.score`` transforms the tuple-keyed ``core.scoring``
   output into rows/summary and picks the headline metric. This logic never touches
   ``.safetensors`` files, so ``core.scoring.<suite>.score_dir`` is monkeypatched with a
   canned result. These run everywhere, including CI, and stay valid while the on-disk
   prediction format is in flux (they mock the *metric dict* boundary, not the format).
3. **generated fixtures** — one test over the pair `tests/fixtures/submissions.py` writes,
   asserting it satisfies validation *and* scoring. The two read different tensors from
   ground truth, and neither side's own tests can see the gap.
4. **real-data integration** — the full stack against the local fixture dataset. Skipped
   when the dataset is absent (e.g. CI), since it is multi-GB and not committed. Format
   correctness itself is covered by the synthetic round-trip in ``ibl-benchmark``.
"""

import math
import zipfile
from pathlib import Path

import pytest

from app.scoring import get_scorer
from app.scoring.ts1 import TS1Scorer
from app.scoring.ts2 import TS2Scorer
from app.scoring.ts3 import TS3Scorer
from app.validation.validate_submission import validate_folder
from tests.fixtures.submissions import write_submission

FIXTURE_ZIP = Path(__file__).parent.joinpath("fixtures", "sample.zip")

# Local-only dataset (not committed — see module docstring).
FIXTURES_DIR = Path.home().joinpath(
    "Documents", "datadisk", "brain-wide-bench", "2026-07", "fixtures"
)
GT_DIR = FIXTURES_DIR.joinpath("ground_truth")
BASELINES_DIR = FIXTURES_DIR.joinpath("baselines")

# ibl_bwb_eval.scoring.aggregation.aggregate's clip set, which every scorer aggregates
# through: a metric named here is floored at 0 per seed and never comes back negative.
CLIPPED_METRICS = frozenset({"r2", "poisson_d2"})

requires_fixtures = pytest.mark.skipif(
    not GT_DIR.is_dir(), reason=f"fixture dataset not found: {GT_DIR}"
)


# ── extract (shared BaseScorer behaviour) ────────────────────────────────────────
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
    empty = tmp_path.joinpath("empty.zip")
    with zipfile.ZipFile(empty, "w") as zf:
        zf.writestr("readme.txt", "no predictions here")
    with pytest.raises(ValueError, match="no 'seed_"):
        TS1Scorer().extract(empty, tmp_path.joinpath("out"))


# ── routing (get_scorer factory) ─────────────────────────────────────────────────
@pytest.mark.parametrize(
    ("task", "expected"),
    [("ts1", TS1Scorer), ("ts2", TS2Scorer), ("ts3", TS3Scorer)],
)
def test_get_scorer_returns_correct_type(task, expected):
    """The factory maps each suite id to its scorer class."""
    assert isinstance(get_scorer(task), expected)


def test_get_scorer_unknown_task():
    """An unregistered task raises KeyError."""
    with pytest.raises(KeyError):
        get_scorer("ts99")


# ── wrapper logic (core.score_dir monkeypatched) ─────────────────────────────────
def test_ts1_wrapper_shape(monkeypatch):
    """TS1Scorer flattens the summary and picks the readout-spec primary metric."""
    raw = {
        ("m", "ts1-choice", "recA", 42): {"bacc": 0.80, "f1": 0.7, "ap": 0.6},
        ("m", "ts1-choice", "recA", 43): {"bacc": 0.90, "f1": 0.8, "ap": 0.7},
    }
    monkeypatch.setattr("ibl_bwb_eval.scoring.ts1.score_dir", lambda p, g: raw)

    result = TS1Scorer().score(Path("pred"), Path("gt"))

    (row,) = result["rows"]
    assert {"label", "task", "recording_id", "metrics"} <= row.keys()
    assert set(row["metrics"]) == {"bacc", "f1", "ap"}
    assert row["metrics"]["bacc"]["n"] == 2
    # headline for ts1-choice is bacc → mean of 0.80 and 0.90
    assert result["summary"]["ts1-choice"]["mean"] == pytest.approx(0.85)


def test_ts2_wrapper_shape(monkeypatch):
    """TS2Scorer keys rows by (label, task, recording_id); headline is the primary metric."""
    # Derive the key from the scorer's own constant so the mock can't drift from it;
    # scorer-vs-core name agreement is covered by the real-data test below.
    from app.scoring.ts2 import PRIMARY_METRIC as TS2_PRIMARY

    raw = {
        ("m", "ts2-co_smoothing", "recA", 42): {TS2_PRIMARY: 0.10, "bps": 0.5},
        ("m", "ts2-co_smoothing", "recA", 43): {TS2_PRIMARY: 0.30, "bps": 0.7},
    }
    monkeypatch.setattr("ibl_bwb_eval.scoring.ts2.score_dir", lambda p, g: raw)

    result = TS2Scorer().score(Path("pred"), Path("gt"))

    (row,) = result["rows"]
    assert row["recording_id"] == "recA"
    assert set(row["metrics"]) == {TS2_PRIMARY, "bps"}
    # both seeds aggregated → n == 2 with a defined SEM
    assert row["metrics"][TS2_PRIMARY]["n"] == 2
    assert row["metrics"][TS2_PRIMARY]["sem"] is not None
    # headline is the primary metric (not bps) → mean of 0.10 and 0.30
    assert result["summary"]["ts2-co_smoothing"]["mean"] == pytest.approx(0.20)


def test_ts3_wrapper_shape(monkeypatch):
    """TS3Scorer keys rows by label only; headline is macro/f1-score."""
    raw = {
        ("m", 42): {"macro/f1-score": 0.60, "macro/precision": 0.5, "VISp/f1-score": 0.4},
        ("m", 43): {"macro/f1-score": 0.80, "macro/precision": 0.7, "VISp/f1-score": 0.6},
    }
    monkeypatch.setattr("ibl_bwb_eval.scoring.ts3.score_dir", lambda p, g: raw)

    result = TS3Scorer().score(Path("pred"), Path("gt"))

    (row,) = result["rows"]
    # aggregate() keys TS3 (label, task, NO_RECORDING_ID); the rows keep the label alone
    assert row["label"] == "m"
    assert row["task"] == "ts3-cosmos"
    assert "recording_id" not in row  # TS3 classifies the whole population at once
    assert "macro/f1-score" in row["metrics"]
    # headline is macro/f1-score → mean of 0.60 and 0.80
    assert result["summary"]["ts3-cosmos"]["mean"] == pytest.approx(0.70)


def test_ts1_clips_r2_at_zero_per_seed(monkeypatch):
    """A negative r2 seed is floored before averaging; metrics outside the clip set are not."""
    raw = {
        ("m", "ts1-wheel_speed", "recA", 42): {"r2": -0.4, "pearson": -0.5, "mae": 1.0},
        ("m", "ts1-wheel_speed", "recA", 43): {"r2": 0.6, "pearson": 0.3, "mae": 0.8},
    }
    monkeypatch.setattr("ibl_bwb_eval.scoring.ts1.score_dir", lambda p, g: raw)

    result = TS1Scorer().score(Path("pred"), Path("gt"))

    (row,) = result["rows"]
    # mean of (0.0, 0.6), not of (-0.4, 0.6) — clipping the mean would give 0.10
    assert row["metrics"]["r2"]["mean"] == pytest.approx(0.30)
    # the SEM is taken over the clipped seeds too
    assert row["metrics"]["r2"]["sem"] == pytest.approx(0.30)
    assert row["metrics"]["pearson"]["mean"] == pytest.approx(-0.10)
    assert result["summary"]["ts1-wheel_speed"]["mean"] == pytest.approx(0.30)


def test_ts2_clips_poisson_d2_but_not_bps(monkeypatch):
    """TS2's primary metric is floored at 0 per seed; bps is left signed."""
    raw = {
        ("m", "ts2-co_smoothing", "recA", 42): {"poisson_d2": -0.2, "bps": -0.6},
        ("m", "ts2-co_smoothing", "recA", 43): {"poisson_d2": 0.4, "bps": 0.2},
    }
    monkeypatch.setattr("ibl_bwb_eval.scoring.ts2.score_dir", lambda p, g: raw)

    result = TS2Scorer().score(Path("pred"), Path("gt"))

    (row,) = result["rows"]
    assert row["metrics"]["poisson_d2"]["mean"] == pytest.approx(0.20)
    assert row["metrics"]["bps"]["mean"] == pytest.approx(-0.20)
    assert result["summary"]["ts2-co_smoothing"]["mean"] == pytest.approx(0.20)


def test_wrapper_empty_input(monkeypatch):
    """An empty core result yields an empty but valid structure for every suite."""
    for suite, mod in (("ts1", "ts1"), ("ts2", "ts2"), ("ts3", "ts3")):
        monkeypatch.setattr(f"ibl_bwb_eval.scoring.{mod}.score_dir", lambda p, g: {})
        assert get_scorer(suite).score(Path("pred"), Path("gt")) == {"rows": [], "summary": {}}


# ── generated fixtures (the pair validation and scoring must share) ───────────────


def test_a_valid_submission_is_also_scorable(tmp_path):
    """The generated fixture has to satisfy both readers, which want different things.

    Validation reads only ``trial_id`` from ground truth, so a fixture can pass it and still
    fail scoring on a missing ``values`` — well formed, but with nothing to be compared to.
    That gap is not visible from either side alone, which is why one test crosses it.

    Asserting a number rather than merely "it ran": all-zero logits against alternating
    labels are a balanced accuracy of 0.5, so a fixture that stops meaning that has changed
    in a way worth noticing.
    """
    pred_dir, gt_dir = write_submission(tmp_path)

    validation = validate_folder(pred_dir, gt_dir)

    assert validation.ok, [(f.code, f.detail) for f in validation.errors]

    results = get_scorer("ts1").score(pred_dir, gt_dir)

    assert results["summary"] == {"ts1-reward": {"mean": 0.5, "sem": None, "n": 1}}
    assert [row["task"] for row in results["rows"]] == ["ts1-reward"]


# ── real-data integration (skipped without the local dataset) ─────────────────────
@requires_fixtures
@pytest.mark.parametrize(
    ("suite", "baseline", "expect_recording_id"),
    [
        ("ts1", "mlp-baseline", True),
        ("ts2", "autoencoder-baseline", True),
        ("ts3", "nuclr_linear_single-baseline", False),
    ],
)
def test_score_real_fixtures(suite, baseline, expect_recording_id):
    """Each scorer runs end-to-end against the local fixtures with finite metrics."""
    result = get_scorer(suite).score(BASELINES_DIR.joinpath(baseline), GT_DIR)

    assert result["rows"], "expected at least one scored row"
    assert result["summary"], "expected at least one task summary"

    for row in result["rows"]:
        assert {"label", "task", "metrics"} <= row.keys()
        assert ("recording_id" in row) == expect_recording_id
        for name, metric in row["metrics"].items():
            assert math.isfinite(metric["mean"])
            assert metric["n"] >= 1
            if name in CLIPPED_METRICS:
                assert metric["mean"] >= 0

    for task_summary in result["summary"].values():
        assert math.isfinite(task_summary["mean"])


@requires_fixtures
def test_score_missing_gt(tmp_path):
    """Missing GT files are skipped gracefully (empty but valid result)."""
    result = get_scorer("ts1").score(BASELINES_DIR.joinpath("mlp-baseline"), tmp_path)
    assert result == {"rows": [], "summary": {}}
