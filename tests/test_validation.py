"""Tests for the submission validator.

Two groups, matching the module's own division:

- Group A takes a list of relative paths and never opens a file, so its tests are string
  lists. This is what the prevalidate endpoint runs.
- Group B opens the predictions and the ground truth they are checked against, so its
  tests build a real tree with ``write_submission`` and state their case as a deviation
  from a valid one.

Every failing case asserts the *code*, not the message: the codes are the contract, and
several deliberately share one submitter-facing sentence.
"""

from pathlib import Path

import torch

from app.validation.validate_submission import (
    MIN_SEEDS,
    crawl_submission_entries,
    validate_folder,
)
from tests.fixtures.submissions import TASK, write_submission

# Ground truth that does not exist, so session coverage (E104) is skipped. Group A's other
# checks need nothing from disk.
NO_GT = Path("/nonexistent-ground-truth")

TS3_TASK = "ts3-cosmos"


def entries(label="mlp", task=TASK, recording="rec1", seeds=(1, 2, 3)):
    """Prediction entries for one task, as a zip's central directory lists them."""
    return [f"{label}/{task}/{recording}/seed_{seed}.safetensors" for seed in seeds]


def crawl(paths, *, gt_dir=NO_GT, is_deterministic=False):
    """Group A over ``paths``."""
    return crawl_submission_entries(paths, gt_dir, is_deterministic)


# ── Group A: paths only ───────────────────────────────────────────────────────


def test_a_well_formed_entry_list_has_nothing_to_report():
    """The shape the writer produces: one label, one task, three contiguous seeds."""
    result = crawl(entries())

    assert result.findings == []
    assert result.labels == {"mlp"}
    assert result.coverage == {(TASK, "rec1"): {1, 2, 3}}
    assert len(result.seed_entries) == 3


def test_ts3_predictions_carry_no_recording_level():
    """ts3 classifies a whole population at once, so its paths are one level shallower."""
    result = crawl([f"mlp/{TS3_TASK}/seed_{seed}.safetensors" for seed in (1, 2, 3)])

    assert result.findings == []
    assert result.coverage == {(TS3_TASK, None): {1, 2, 3}}


def test_path_shape_faults_are_reported_per_file():
    """Each way a path can be wrong has its own code, and names the file it came from."""
    result = crawl(
        entries()
        + [
            f"mlp/{TASK}/rec1/seed_x.safetensors",  # E004 meant to be a seed file
            "mlp/ts1-nosuchtask/rec1/seed_1.safetensors",  # E005 unrecognised task
            f"mlp/{TASK}/seed_1.safetensors",  # E013 ts1 without a recording
            f"mlp/{TS3_TASK}/rec1/seed_1.safetensors",  # E013 ts3 with one
            "notes.md",  # E014 simply unexpected
        ]
    )

    assert sorted(finding.code for finding in result.findings) == [
        "E004",
        "E005",
        "E013",
        "E013",
        "E014",
    ]

    misnamed = next(f for f in result.findings if f.code == "E004")

    assert misnamed.path == f"mlp/{TASK}/rec1/seed_x.safetensors"


def test_a_misnamed_seed_file_is_not_also_an_unexpected_one():
    """E004 owns it. Reporting E014 as well would fault one file twice."""
    result = crawl([f"mlp/{TASK}/rec1/seed_x.safetensors"])

    assert [finding.code for finding in result.findings] == ["E004"]


def test_editor_and_archiver_droppings_are_ignored():
    """A .DS_Store or a __MACOSX tree is not the submitter's doing."""
    result = crawl(
        entries()
        + ["mlp/.DS_Store", "mlp/Thumbs.db", "mlp/__MACOSX/whatever.txt", "mlp/subdir/"]
    )

    assert result.findings == []


def test_leading_zeros_do_not_make_a_second_seed():
    """seed_042 and seed_42 are the same seed, and the duplicate is reported."""
    result = crawl(
        [f"mlp/{TASK}/rec1/seed_{seed}.safetensors" for seed in ("1", "2", "3", "03")]
    )

    assert [finding.code for finding in result.findings] == ["E105"]


def test_one_submission_carries_one_label():
    """Two labels in a tree is two submissions, which is not what was uploaded."""
    result = crawl(entries(label="mlp") + entries(label="other"))

    assert "E106" in [finding.code for finding in result.findings]


def test_a_task_needs_enough_contiguous_seeds():
    """Fewer than the minimum is E101; a gap is E102."""
    assert [f.code for f in crawl(entries(seeds=(1,))).findings] == ["E101"]
    assert [f.code for f in crawl(entries(seeds=(1, 2, 9))).findings] == ["E102"]
    assert crawl(entries(seeds=tuple(range(1, MIN_SEEDS + 1)))).findings == []


def test_a_tasks_recordings_share_one_seed_set():
    """Seeds differing across a task's recordings means the runs are not comparable."""
    result = crawl(
        entries(recording="rec1", seeds=(1, 2, 3)) + entries(recording="rec2", seeds=(4, 5, 6))
    )

    assert [finding.code for finding in result.findings] == ["E103"]


def test_declaring_determinism_skips_every_seed_check():
    """The three seed codes are the whole of what the flag governs."""
    paths = entries(recording="rec1", seeds=(1,)) + entries(recording="rec2", seeds=(9,))

    assert sorted(f.code for f in crawl(paths).findings) == ["E103"]
    assert crawl(paths, is_deterministic=True).findings == []


def test_session_coverage_needs_ground_truth_and_is_skipped_without_it(tmp_path):
    """E104 is the one Group A check reading anything outside the submission."""
    _, gt_dir = write_submission(tmp_path, recording="rec1")
    gt_dir.joinpath(TASK, "rec2").mkdir(parents=True)
    gt_dir.joinpath(TASK, "rec2", "ground_truth.safetensors").write_bytes(b"")

    submitted = entries(recording="rec1")

    assert [f.code for f in crawl(submitted, gt_dir=gt_dir).findings] == ["E104"]
    assert crawl(submitted).findings == []


# ── Group B: the files themselves ─────────────────────────────────────────────


def test_a_valid_submission_passes(tmp_path):
    """The whole validator over a submission with nothing wrong with it."""
    pred_dir, gt_dir = write_submission(tmp_path)

    result = validate_folder(pred_dir, gt_dir)

    assert result.ok
    assert result.errors == []
    assert result.coverage == {(TASK, "rec1"): {1, 2, 3}}


def test_an_archive_with_no_predictions_is_not_valid(tmp_path):
    """Nothing to fault, and still not a submission — which is what ``ok`` distinguishes."""
    empty = tmp_path.joinpath("pred")
    empty.mkdir()

    result = validate_folder(empty, tmp_path.joinpath("gt"))

    assert not result.ok
    assert result.predictions_missing
    assert result.errors == []


def test_metadata_must_be_complete(tmp_path):
    """A missing required field is E001, whichever field it is."""
    pred_dir, gt_dir = write_submission(tmp_path, metadata={"unit_filtering": None})

    result = validate_folder(pred_dir, gt_dir)

    assert {finding.code for finding in result.errors} == {"E001"}


def test_unit_filtering_comes_from_a_closed_set(tmp_path):
    """A build label outside the known set cannot be interpreted."""
    pred_dir, gt_dir = write_submission(tmp_path, metadata={"unit_filtering": "whatever"})

    result = validate_folder(pred_dir, gt_dir)

    assert {finding.code for finding in result.errors} == {"E002"}


def test_metadata_must_agree_with_the_path(tmp_path):
    """The path and the file's own metadata are two claims that have to match."""
    pred_dir, gt_dir = write_submission(tmp_path, metadata={"label": "somethingelse"})

    result = validate_folder(pred_dir, gt_dir)

    assert {finding.code for finding in result.errors} == {"E013"}


def test_predictions_must_have_the_readout_dimension(tmp_path):
    """ts1-reward reads out two dimensions; anything else is not that task's output."""
    pred_dir, gt_dir = write_submission(tmp_path, dims=5)

    result = validate_folder(pred_dir, gt_dir)

    assert {finding.code for finding in result.errors} == {"E006"}


def test_predictions_must_be_finite(tmp_path):
    """A NaN cannot be scored, and is a fact about the submitter's own data."""
    predictions = torch.zeros(4, 1, 2)
    predictions[0, 0, 0] = float("nan")

    pred_dir, gt_dir = write_submission(tmp_path, predictions=predictions)

    result = validate_folder(pred_dir, gt_dir)

    assert {finding.code for finding in result.errors} == {"E107"}


def test_a_task_recording_needs_ground_truth(tmp_path):
    """Predictions for something we cannot score are not a submission we can accept."""
    pred_dir, gt_dir = write_submission(tmp_path, ground_truth=False)

    result = validate_folder(pred_dir, gt_dir)

    assert {finding.code for finding in result.errors} == {"E011"}


def test_predictions_must_cover_exactly_the_ground_truths_trials(tmp_path):
    """A different trial set means the two are not aligned, so the comparison is meaningless."""
    pred_dir, gt_dir = write_submission(tmp_path, gt_trial_ids=[7, 8, 9, 10])

    result = validate_folder(pred_dir, gt_dir)

    assert {finding.code for finding in result.errors} == {"E012"}


def test_the_dataset_version_range_is_inclusive_and_ordered_properly(tmp_path):
    """Compared as versions, not as strings — "1.10.0" is newer than "1.9.0"."""
    pred_dir, gt_dir = write_submission(tmp_path, metadata={"dataset_version": "1.10.0"})

    assert validate_folder(pred_dir, gt_dir, "1.9.0", "2.0.0").ok

    result = validate_folder(pred_dir, gt_dir, "1.11.0", None)

    assert {finding.code for finding in result.errors} == {"E108"}


def test_every_finding_carries_a_submitter_safe_message(tmp_path):
    """``message`` is what a submitter reads; ``detail`` is ours and never relayed."""
    pred_dir, gt_dir = write_submission(tmp_path, seeds=(1,), metadata={"unit_filtering": None})

    result = validate_folder(pred_dir, gt_dir)

    assert {finding.code for finding in result.errors} == {"E001", "E101"}

    for finding in result.errors:
        assert finding.message
        assert finding.message != finding.detail
