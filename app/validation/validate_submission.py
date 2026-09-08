"""Validate a submission folder before scoring.

Structural/format validation only. The file is organized into two independent groups:

  GROUP A: path-only checks. Never opens a file's content. Operates purely on the
  submission's directory tree (folder names + filenames), which already encodes
  (label, task, recording_id, seed) by construction. This group contains checks that
  can be ported to a client-side pre-flight check, before the upload is even sent
  to the backend.

  GROUP B: file-opening checks. Reads the actual prediction file (and the
  matching ground-truth file) via safetensors.

Every failure carries an opaque code (see CODES below) plus an internal ``detail``
string with the full diagnostic. Only ``detail`` is safe to log/debug with, since it can
reveal ground-truth structure (e.g. which trial_ids/timestamps/unit_ids were expected),
so it must never be relayed to the submitter. Most codes map to one generic,
deliberately vague message ("use the benchmark's prediction infra, contact us if
stuck") so a submitter can't use error text to reverse-engineer what's checked. A
short allow-list of codes (the E1xx family) get a specific, safe message instead,
because they're facts about the submitter's own submission (seed count, NaN
presence, etc.) that don't leak anything and are easy to self-fix once named.

Usage:
    python validate_submission.py predictions/mlp-baseline ground_truth
"""

import argparse
import re
import sys
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath

from rich.console import Console
from safetensors import safe_open

from ibl_bwb_eval._unit_ids import decode_unit_ids
from ibl_bwb_eval.tasks import SUITE_TASKS, check_ts3_label_order, get_ts1_readout_spec, task_id

####################################################################################
# ERROR CODES & RESULT TYPES
#
# Common vocabulary used by both groups below: codes, messages, and the Finding
# and error types each check raises.
####################################################################################

GENERIC_MESSAGE = (
    "Submission failed validation. Make sure it was generated with the benchmark's "
    "prediction-saving infrastructure (PredictionsWriter) as documented, without any "
    "hand editing of the output. If you're stuck, please contact us with your submission "
    "folder and include this error code."
)

# Codes not listed here fall back to GENERIC_MESSAGE. Kept deliberately vague so
# the exact check can't be reverse-engineered from the response. Comments here are
# for our own maintenance only; they are never shown to a submitter.
CODES = {
    # generic-message family
    "E001": "missing required metadata field(s)",
    "E002": "unit_filtering not in the closed set of build labels",
    "E003": "dataset_version malformed (not x.y.z)",
    "E004": "filename doesn't match 'seed_<N>.safetensors'",
    "E005": "unrecognized task id in path",
    "E006": "TS1: missing tensor(s) or bad shape",
    "E007": "TS2: missing tensor(s) or bad shape",
    "E008": "TS2: duplicate window_timestamps",
    "E009": "TS3: missing tensor(s) or bad shape",
    "E010": "TS3: label_names order mismatch vs. canonical vocabulary",
    "E011": "no ground truth found for this task/recording",
    "E012": "prediction's alignment basis doesn't match ground truth",
    "E013": "path (folder names / filename) doesn't match the file's own metadata",
    "E014": "unexpected file/dir found in submission tree",
    "E999": "unexpected internal error while validating a file",
    # specific-message family (safe to reveal: facts about the submitter's own data)
    "E101": "fewer than the minimum required seeds for a task",
    "E102": "seeds for a task are not contiguous",
    "E103": "seed sets differ across sessions for the same task",
    "E104": "missing predictions for one or more required sessions",
    "E105": "duplicate (label, task, recording_id, seed)",
    "E106": "multiple labels found in one submission",
    "E107": "predictions/pred_proba contain NaN or Inf",
    "E108": "dataset_version outside the accepted range",
    "E109": "unit_filtering is not the value this task suite requires (TS2/TS3 require 'selected_units')",
}

SPECIFIC_MESSAGES = {
    "E101": "Each task needs at least 3 distinct seeds for non-deterministic models.",
    "E102": "Seeds for a task must be contiguous integers (e.g. 42, 43, 44).",
    "E103": "All sessions for a task must use the same set of seeds.",
    "E104": "Submission is missing predictions for one or more required sessions of an attempted task.",
    "E105": "Duplicate seed file detected for the same task/session.",
    "E106": "A submission folder must contain exactly one model label.",
    "E107": "Predictions contain NaN or Inf values.",
    "E108": "This submission was generated against an unsupported dataset version.",
    "E109": "unit_filtering must be 'selected_units' for this task suite.",
}


def user_message(code: str) -> str:
    """The safe, submitter-facing text for a code. Never reveals check internals."""
    return SPECIFIC_MESSAGES.get(code, GENERIC_MESSAGE)


@dataclass
class Finding:
    path: str  # entry, relative to the submission root; "." for the submission as a whole
    code: str
    detail: str  # full diagnostic, for OUR debugging only; never relay to the submitter

    @property
    def message(self) -> str:
        return user_message(self.code)


class SubmissionValidationError(Exception):
    def __init__(self, code: str, detail: str):
        assert code in CODES, f"unregistered error code {code!r}"
        self.code = code
        self.detail = detail
        super().__init__(f"[{code}] {detail}")


####################################################################################
# GROUP A: PATH-ONLY CHECKS
#
# Nothing below this banner (down to the next one) ever opens a file's content:
# no safetensors import is used here. Everything operates on the submission's
# directory tree alone: folder names, filenames, and (for one check) a
# ground-truth directory listing.
#
# The group runs on a list of relative paths alone, so a client can have it answered
# before uploading anything: a browser reads the zip's central directory and posts the
# entries to the pre-flight endpoint, which calls crawl_submission_entries below.
#
# _check_session_coverage is the one check needing more than the list: it reads the
# ground-truth directory, which only the server has. It is skipped where that is
# unavailable, and the authoritative run after the upload catches what it missed.
####################################################################################

TS1_TASK_IDS = {task_id("ts1", t) for t in SUITE_TASKS["ts1"]}
TS2_TASK_IDS = {task_id("ts2", t) for t in SUITE_TASKS["ts2"]}
TS3_TASK_IDS = {task_id("ts3", t) for t in SUITE_TASKS["ts3"]}

SEED_FILENAME_RE = re.compile(r"^seed_(\d+)\.safetensors$")
MIN_SEEDS = 3


def _is_seed_filename(name: str) -> bool:
    """Whether ``name`` was meant to be a prediction file, correctly named or not.

    Deliberately looser than ``SEED_FILENAME_RE``: the gap between the two is E004's
    population — a file meant to be a seed file whose name is wrong, which is a different
    fault from an unexpected file (E014).
    """
    return name.startswith("seed_") and name.endswith(".safetensors")

# Finding.path for a finding about the submission as a whole rather than one file.
SUBMISSION_ROOT = "."

IGNORED_FILES = {".DS_Store", "Thumbs.db", "desktop.ini"}
IGNORED_DIRS = {"__MACOSX"}

ParsedPath = tuple[str, str, str | None, int]  # (label, task, recording_id, seed)


def _parse_entry(entry: str) -> ParsedPath:
    """Derive (label, task, recording_id, seed) purely from a relative entry path.

    Expected shape: <label>/<task>/[<recording_id>/]seed_<N>.safetensors. The recording_id
    level exists for ts1-*/ts2-* tasks, and is absent for ts3-* tasks (see
    PredictionsWriter's ``_output_path``). Raises on any deviation.
    """
    rel_parts = PurePosixPath(entry).parts

    m = SEED_FILENAME_RE.match(rel_parts[-1])
    if not m:
        raise SubmissionValidationError("E004", f"filename {rel_parts[-1]!r} doesn't match 'seed_<N>.safetensors'")
    seed = int(m.group(1))

    dir_parts = rel_parts[:-1]
    if len(dir_parts) == 3:
        label, task, recording_id = dir_parts
    elif len(dir_parts) == 2:
        label, task = dir_parts
        recording_id = None
    else:
        raise SubmissionValidationError("E013", f"unexpected path depth: {entry}")

    if task not in (TS1_TASK_IDS | TS2_TASK_IDS | TS3_TASK_IDS):
        raise SubmissionValidationError("E005", f"unrecognized task id {task!r} in path {entry}")

    needs_recording_id = task in (TS1_TASK_IDS | TS2_TASK_IDS)
    if needs_recording_id and recording_id is None:
        raise SubmissionValidationError(
            "E013", f"task {task!r} is missing its recording_id path level: {entry}"
        )
    if not needs_recording_id and recording_id is not None:
        raise SubmissionValidationError(
            "E013", f"ts3 task {task!r} shouldn't have a recording_id path level: {entry}"
        )

    return label, task, recording_id, seed


def _find_structure_errors(entries: Iterable[str]) -> list[tuple[str, str]]:
    """Flag any entry that isn't part of the expected layout."""
    errors = []
    for entry in entries:
        parts = PurePosixPath(entry).parts
        if any(part in IGNORED_DIRS for part in parts):
            continue
        if parts[-1] in IGNORED_FILES:
            continue
        # A misnamed seed file is E004's, raised where the entry is parsed. Reporting it
        # here as well would fault the same file twice.
        if not _is_seed_filename(parts[-1]):
            errors.append(("E014", f"unexpected file: {entry}"))
    return errors


def _check_seed_consistency(coverage: dict[tuple[str, str | None], set[int]]) -> list[tuple[str, str]]:
    """Per task: every recording shares the same seed set, it's >= MIN_SEEDS, and contiguous."""
    errors = []
    by_task: dict[str, dict[str | None, set[int]]] = defaultdict(dict)
    for (task, recording_id), seeds in coverage.items():
        by_task[task][recording_id] = seeds

    for task, per_recording in sorted(by_task.items()):
        distinct_seed_sets = {frozenset(s) for s in per_recording.values()}
        if len(distinct_seed_sets) > 1:
            shown = {rec: sorted(seeds) for rec, seeds in list(per_recording.items())[:5]}
            errors.append(("E103", f"task {task!r} has inconsistent seed sets across recordings, e.g. {shown}"))
            continue

        seeds = next(iter(distinct_seed_sets))
        if len(seeds) < MIN_SEEDS:
            errors.append(
                ("E101", f"task {task!r} has only {len(seeds)} seed(s) ({sorted(seeds)}); need >= {MIN_SEEDS}")
            )
            continue

        sorted_seeds = sorted(seeds)
        if sorted_seeds != list(range(sorted_seeds[0], sorted_seeds[0] + len(sorted_seeds))):
            errors.append(("E102", f"task {task!r} seeds are not contiguous: {sorted_seeds}"))

    return errors


def _check_session_coverage(coverage: dict[tuple[str, str | None], set[int]], gt_dir: Path) -> list[tuple[str, str]]:
    """For every ts1/ts2 task attempted, every GT recording_id must have predictions.

    The one check in this group needing external reference data (the ground-truth
    directory listing) rather than just the submission's own tree; see the group
    docstring above.
    """
    errors = []
    submitted_recordings_by_task: dict[str, set[str]] = defaultdict(set)
    for task, recording_id in coverage:
        if recording_id is not None:
            submitted_recordings_by_task[task].add(recording_id)

    for task in submitted_recordings_by_task:
        gt_task_dir = gt_dir / task
        if not gt_task_dir.is_dir():
            continue
        gt_recordings = {
            rec_dir.name
            for rec_dir in gt_task_dir.iterdir()
            if (rec_dir / "ground_truth.safetensors").exists()
        }
        missing = gt_recordings - submitted_recordings_by_task[task]
        if missing:
            shown = sorted(missing)[:10]
            errors.append(
                (
                    "E104",
                    f"task {task!r} is missing predictions for {len(missing)}/{len(gt_recordings)} "
                    f"session(s), e.g. {shown}",
                )
            )

    return errors


@dataclass
class PathCrawlResult:
    parsed_by_entry: dict[str, ParsedPath]  # only entries with a well-formed path
    seed_entries: list[str]  # every seed_*.safetensors entry, parsed or not
    findings: list[Finding]
    labels: set[str]
    coverage: dict[tuple[str, str | None], set[int]]


def crawl_submission_entries(
    entries: Iterable[str], gt_dir: Path, is_deterministic: bool
) -> PathCrawlResult:
    """Run every path-only check over relative POSIX entry paths. Never opens a file.

    ``entries`` is the whole submission, not just its prediction files:
    :func:`_find_structure_errors` judges what should not be there. Trailing-slash entries
    are the directory records some zip writers emit, and are not files.

    ``gt_dir`` need not exist; :func:`_check_session_coverage` skips a task whose
    ground-truth directory is absent, which is how a caller without ground truth gets
    every other check.
    """
    files = [entry for entry in entries if entry and not entry.endswith("/")]
    seed_entries = sorted(
        entry for entry in files if _is_seed_filename(PurePosixPath(entry).name)
    )

    findings: list[Finding] = []
    parsed_by_entry: dict[str, ParsedPath] = {}
    seen: dict[ParsedPath, str] = {}
    labels: set[str] = set()
    coverage: dict[tuple[str, str | None], set[int]] = defaultdict(set)

    for entry in seed_entries:
        try:
            parsed = _parse_entry(entry)
        except SubmissionValidationError as e:
            findings.append(Finding(entry, e.code, e.detail))
            continue

        # Leading zeros make distinct filenames parse to the same tuple: seed_042.safetensors
        # and seed_42.safetensors both mean seed 42.
        if parsed in seen:
            findings.append(
                Finding(entry, "E105", f"duplicate (label, task, recording_id, seed), also produced by {seen[parsed]}")
            )
            continue
        seen[parsed] = entry

        parsed_by_entry[entry] = parsed
        label, task, recording_id, seed = parsed
        labels.add(label)
        coverage[(task, recording_id)].add(seed)

    if len(labels) > 1:
        findings.append(Finding(SUBMISSION_ROOT, "E106", f"multiple labels found in one submission: {sorted(labels)}"))

    for code, detail in _find_structure_errors(files):
        findings.append(Finding(SUBMISSION_ROOT, code, detail))
    if not is_deterministic:
        for code, detail in _check_seed_consistency(coverage):
            findings.append(Finding(SUBMISSION_ROOT, code, detail))
    for code, detail in _check_session_coverage(coverage, gt_dir):
        findings.append(Finding(SUBMISSION_ROOT, code, detail))

    return PathCrawlResult(parsed_by_entry, seed_entries, findings, labels, dict(coverage))


def crawl_submission_paths(submission_dir: Path, gt_dir: Path, is_deterministic: bool) -> PathCrawlResult:
    """Run :func:`crawl_submission_entries` over an extracted submission directory."""
    entries = [
        path.relative_to(submission_dir).as_posix()
        for path in sorted(submission_dir.rglob("*"))
        if path.is_file()
    ]
    return crawl_submission_entries(entries, gt_dir, is_deterministic)


####################################################################################
# GROUP B: FILE-OPENING CHECKS
#
# Everything below this banner opens the prediction file and/or the matching
# ground-truth file via safetensors (metadata(), get_slice(), get_tensor()).
# Backend-only: needs the real tensor bytes and the ground-truth reference
# data, so it cannot be ported to a browser-side pre-check.
####################################################################################

# Mirrors core.data.unit_filtering.UnitFiltering in the ibl-benchmark repo, plus "mixed"
# (a build spanning recordings with different labels). A data-build concept, not part of
# ibl_bwb_eval's evaluation contract, so it isn't importable from there; keep in sync.
UNIT_FILTERING_VALUES = {"all_units", "selected_units", "custom", "mixed"}
VERSION_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")

# ts1 accepts any recognized build label; ts2/ts3 require the canonical eval build.
REQUIRED_UNIT_FILTERING = {"ts2": "selected_units", "ts3": "selected_units"}


def _require_keys(present: set[str], required: set[str], what: str) -> None:
    missing = required - present
    if missing:
        raise SubmissionValidationError("E001", f"missing required {what}: {sorted(missing)}")


def _decode_ids(tensor) -> set[str]:
    """Decode an entity-id tensor (see ibl_bwb_eval._unit_ids: variable-width, NUL-padded)."""
    return set(decode_unit_ids(tensor).tolist())


def _parse_version(s: str) -> tuple[int, int, int]:
    m = VERSION_RE.match(s)
    if not m:
        raise SubmissionValidationError("E003", f"dataset_version {s!r} isn't in x.y.z format")
    return tuple(int(g) for g in m.groups())


def _check_basis_match(pred_values: set, gt_values: set, mode: str, what: str) -> None:
    """``mode='exact'``: pred must equal gt. ``mode='superset'``: pred must cover gt."""
    missing = gt_values - pred_values
    extra = pred_values - gt_values if mode == "exact" else set()
    if missing or extra:
        detail = f"{len(missing)} missing"
        if mode == "exact":
            detail += f", {len(extra)} unexpected"
        shown_missing = sorted(missing)[:5]
        raise SubmissionValidationError(
            "E012", f"{what} doesn't match ground truth ({detail}): missing e.g. {shown_missing}"
        )


def _check_common_metadata(
    meta: dict,
    parsed: ParsedPath,
    min_dataset_version: str | None,
    max_dataset_version: str | None,
) -> None:
    """Field presence/validity, plus cross-checking metadata against Group A's parsed path."""
    _require_keys(set(meta), {"label", "task", "seed", "unit_filtering", "dataset_version"}, "metadata field(s)")

    if meta["unit_filtering"] not in UNIT_FILTERING_VALUES:
        raise SubmissionValidationError(
            "E002", f"unit_filtering={meta['unit_filtering']!r} is not one of {sorted(UNIT_FILTERING_VALUES)}"
        )

    version = _parse_version(meta["dataset_version"])
    if min_dataset_version is not None and version < _parse_version(min_dataset_version):
        raise SubmissionValidationError(
            "E108",
            f"dataset_version {meta['dataset_version']} is older than the minimum accepted {min_dataset_version}",
        )
    if max_dataset_version is not None and version > _parse_version(max_dataset_version):
        raise SubmissionValidationError(
            "E108",
            f"dataset_version {meta['dataset_version']} is newer than the maximum accepted {max_dataset_version}",
        )

    label, task, recording_id, seed = parsed
    if meta["label"] != label or meta["task"] != task or int(meta["seed"]) != seed:
        raise SubmissionValidationError(
            "E013",
            f"metadata (label={meta['label']!r}, task={meta['task']!r}, seed={meta['seed']!r}) "
            f"doesn't match its path ({label}/{task}/.../seed_{seed})",
        )
    if recording_id is not None and meta.get("recording_id") != recording_id:
        raise SubmissionValidationError(
            "E013", f"metadata recording_id={meta.get('recording_id')!r} doesn't match its path ({recording_id!r})"
        )


def _check_ts1(f, meta: dict, gt_dir: Path) -> None:
    task = meta["task"]
    _require_keys(set(meta), {"recording_id"}, "metadata field(s)")
    _require_keys(set(f.keys()), {"predictions", "trial_id"}, "tensor(s)")

    spec = get_ts1_readout_spec(task.split("-", 1)[1])
    pred_shape = f.get_slice("predictions").get_shape()
    trial_shape = f.get_slice("trial_id").get_shape()
    if len(pred_shape) != 3:
        raise SubmissionValidationError("E006", f"'predictions' must be 3D (N, T, D), got shape {pred_shape}")
    if pred_shape[-1] != spec.dim:
        raise SubmissionValidationError(
            "E006", f"'predictions' last dim {pred_shape[-1]} != expected dim {spec.dim} for task {task!r}"
        )
    if trial_shape[0] != pred_shape[0]:
        raise SubmissionValidationError(
            "E006", f"'trial_id' length {trial_shape[0]} != 'predictions' first dim {pred_shape[0]}"
        )

    if not f.get_tensor("predictions").isfinite().all():
        raise SubmissionValidationError("E107", "'predictions' contains NaN/Inf")

    gt_path = gt_dir / task / meta["recording_id"] / "ground_truth.safetensors"
    if not gt_path.exists():
        raise SubmissionValidationError("E011", f"no ground truth at {gt_path}")
    with safe_open(str(gt_path), framework="pt") as gt_f:
        gt_trial_id = set(gt_f.get_tensor("trial_id").tolist())
    pred_trial_id = set(f.get_tensor("trial_id").tolist())
    _check_basis_match(pred_trial_id, gt_trial_id, "exact", "trial_id")


def _check_ts2(f, meta: dict, gt_dir: Path) -> None:
    task = meta["task"]
    if meta["unit_filtering"] != REQUIRED_UNIT_FILTERING["ts2"]:
        raise SubmissionValidationError(
            "E109", f"unit_filtering={meta['unit_filtering']!r} but ts2 requires {REQUIRED_UNIT_FILTERING['ts2']!r}"
        )
    _require_keys(set(meta), {"recording_id"}, "metadata field(s)")
    _require_keys(set(f.keys()), {"predictions", "window_timestamps", "unit_ids"}, "tensor(s)")

    pred_shape = f.get_slice("predictions").get_shape()
    ts_shape = f.get_slice("window_timestamps").get_shape()
    if len(pred_shape) != 3:
        raise SubmissionValidationError("E007", f"'predictions' must be 3D (W, T, U), got shape {pred_shape}")
    if len(ts_shape) != 1 or ts_shape[0] != pred_shape[0]:
        raise SubmissionValidationError(
            "E007", f"'window_timestamps' shape {ts_shape} doesn't match 'predictions' window dim {pred_shape[0]}"
        )

    window_timestamps = f.get_tensor("window_timestamps")
    if window_timestamps.unique().numel() != window_timestamps.numel():
        raise SubmissionValidationError("E008", "'window_timestamps' has duplicate values, which breaks GT alignment")

    if not f.get_tensor("predictions").isfinite().all():
        raise SubmissionValidationError("E107", "'predictions' contains NaN/Inf")

    gt_path = gt_dir / task / meta["recording_id"] / "ground_truth.safetensors"
    if not gt_path.exists():
        raise SubmissionValidationError("E011", f"no ground truth at {gt_path}")
    with safe_open(str(gt_path), framework="pt") as gt_f:
        gt_window_ts = set(gt_f.get_tensor("window_timestamps").tolist())
        gt_unit_ids = _decode_ids(gt_f.get_tensor("unit_ids"))
    _check_basis_match(set(window_timestamps.tolist()), gt_window_ts, "exact", "window_timestamps")
    _check_basis_match(_decode_ids(f.get_tensor("unit_ids")), gt_unit_ids, "exact", "unit_ids")


def _check_ts3(f, meta: dict, gt_dir: Path) -> None:
    task = meta["task"]
    if meta["unit_filtering"] != REQUIRED_UNIT_FILTERING["ts3"]:
        raise SubmissionValidationError(
            "E109", f"unit_filtering={meta['unit_filtering']!r} but ts3 requires {REQUIRED_UNIT_FILTERING['ts3']!r}"
        )
    _require_keys(set(meta), {"label_names"}, "metadata field(s)")
    _require_keys(set(f.keys()), {"pred_proba", "entity_ids"}, "tensor(s)")

    label_names = meta["label_names"].split(",")
    try:
        check_ts3_label_order(label_names, task.split("-", 1)[1])
    except ValueError as e:
        raise SubmissionValidationError("E010", str(e)) from e

    proba_shape = f.get_slice("pred_proba").get_shape()
    uid_shape = f.get_slice("entity_ids").get_shape()
    if len(proba_shape) != 2:
        raise SubmissionValidationError("E009", f"'pred_proba' must be 2D (N, C), got shape {proba_shape}")
    if proba_shape[1] != len(label_names):
        raise SubmissionValidationError(
            "E009", f"'pred_proba' class dim {proba_shape[1]} != len(label_names) ({len(label_names)})"
        )
    # entity_ids is variable-width (NUL-padded to the batch's longest id), so only the
    # row count is checked here; see ibl_bwb_eval._unit_ids.
    if len(uid_shape) != 2 or uid_shape[0] != proba_shape[0]:
        raise SubmissionValidationError(
            "E009", f"'entity_ids' shape {uid_shape} doesn't have {proba_shape[0]} rows to match 'pred_proba'"
        )
    try:
        decode_unit_ids(f.get_tensor("entity_ids"))
    except UnicodeDecodeError as e:
        raise SubmissionValidationError("E009", f"'entity_ids' isn't valid ascii: {e}") from e

    if not f.get_tensor("pred_proba").isfinite().all():
        raise SubmissionValidationError("E107", "'pred_proba' contains NaN/Inf")

    gt_path = gt_dir / task / "ground_truth.safetensors"
    if not gt_path.exists():
        raise SubmissionValidationError("E011", f"no ground truth at {gt_path}")
    with safe_open(str(gt_path), framework="pt") as gt_f:
        gt_entity_ids = _decode_ids(gt_f.get_tensor("entity_ids"))
    _check_basis_match(_decode_ids(f.get_tensor("entity_ids")), gt_entity_ids, "superset", "entity_ids")


def validate_file(
    pred_path: Path,
    parsed: ParsedPath,
    gt_dir: Path,
    min_dataset_version: str | None,
    max_dataset_version: str | None,
) -> None:
    """Open the file and run every content check. ``parsed`` is Group A's parsed
    (label, task, recording_id, seed) for this path, used to cross-check the metadata inside.
    Raises SubmissionValidationError.
    """
    _, task, _, _ = parsed
    with safe_open(str(pred_path), framework="pt") as f:
        meta = f.metadata() or {}
        _check_common_metadata(meta, parsed, min_dataset_version, max_dataset_version)

        if task.startswith("ts1-"):
            _check_ts1(f, meta, gt_dir)
        elif task.startswith("ts2-"):
            _check_ts2(f, meta, gt_dir)
        else:
            _check_ts3(f, meta, gt_dir)


####################################################################################
# ORCHESTRATION + CLI
#
# Combines both groups: Group A's fast path-only crawl runs first, then Group B
# opens only the files that parsed cleanly.
####################################################################################


@dataclass
class ValidationResult:
    pred_entries: list[str]
    errors: list[Finding]
    labels: set[str]
    coverage: dict[tuple[str, str | None], set[int]] = field(default_factory=dict)  # (task, recording_id) -> seeds

    @property
    def ok(self) -> bool:
        return not self.predictions_missing and not self.errors

    @property
    def predictions_missing(self) -> bool:
        return not self.pred_entries


def validate_folder(
    submission_dir: Path,
    gt_dir: Path,
    min_dataset_version: str | None = None,
    max_dataset_version: str | None = None,
    is_deterministic: bool = False,
) -> ValidationResult:
    """Crawl ``submission_dir`` for prediction files and validate each one.

    ``min_dataset_version``/``max_dataset_version`` (``"x.y.z"``, inclusive) bound the
    accepted ``dataset_version`` metadata, compared by proper version ordering rather
    than string comparison. Pass either as ``None`` to leave that side unbounded.

    ``is_deterministic`` must be explicitly set by the submitter (never inferred) to skip
    the seed-count/contiguity/cross-recording-consistency checks entirely, for models that
    genuinely have no randomness to seed (e.g. a closed-form linear model).

    Every ``Finding`` in the result carries a ``code`` (safe to relay) and a ``detail``
    (internal-only: may reveal ground-truth structure, never show it to the submitter).
    """
    crawl = crawl_submission_paths(submission_dir, gt_dir, is_deterministic)
    errors: list[Finding] = list(crawl.findings)

    for entry, parsed in crawl.parsed_by_entry.items():
        try:
            validate_file(
                submission_dir.joinpath(entry), parsed, gt_dir, min_dataset_version, max_dataset_version
            )
        except SubmissionValidationError as e:
            errors.append(Finding(entry, e.code, e.detail))
        except Exception as e:  # unexpected, but still report; don't crash the whole run
            errors.append(Finding(entry, "E999", f"unexpected error: {e!r}"))

    return ValidationResult(crawl.seed_entries, errors, crawl.labels, crawl.coverage)


def print_report(result: ValidationResult, submission_dir: Path, console: Console) -> None:
    """CLI-only debug view: shows both the submitter-safe message and the internal detail.

    A real integration should relay only ``.code``/``.message`` to the submitter and
    log ``.detail`` (or this whole report) internally; never show ``.detail`` to them.
    """
    if result.predictions_missing:
        console.print(f"[red]FAIL[/red] no seed_*.safetensors files found under {submission_dir}")
        return

    console.print(f"Checked {len(result.pred_entries)} file(s) under {submission_dir}")

    if result.errors:
        console.print(f"[red]FAIL[/red] {len(result.errors)} error(s):")
        for f in result.errors:
            console.print(f"  [red]{f.path}[/red] [bold]{f.code}[/bold]: {f.message}")
            console.print(f"      [dim](debug only) {f.detail}[/dim]")
        return

    console.print(
        f"[green]PASS[/green] label={next(iter(result.labels))!r}, "
        f"{len(result.coverage)} (task, recording_id) pair(s), {len(result.pred_entries)} file(s) total"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("submission_dir", type=Path, help="Root of the uploaded submission folder.")
    parser.add_argument(
        "gt_dir", type=Path,
        help="Ground truth root. Checks GT files exist and matches the prediction's alignment basis.",
    )
    parser.add_argument(
        "--min-dataset-version", type=str, default=None,
        help="Oldest accepted dataset_version (x.y.z, inclusive). Unbounded if omitted.",
    )
    parser.add_argument(
        "--max-dataset-version", type=str, default=None,
        help="Newest accepted dataset_version (x.y.z, inclusive). Unbounded if omitted.",
    )
    parser.add_argument(
        "--is-deterministic", action="store_true",
        help="Submitter asserts the model has no randomness to seed; skips all seed-related checks.",
    )
    args = parser.parse_args()

    result = validate_folder(
        args.submission_dir, args.gt_dir, args.min_dataset_version, args.max_dataset_version,
        args.is_deterministic,
    )
    print_report(result, args.submission_dir, Console())
    return 0 if result.ok else 1


if __name__ == "__main__":
    sys.exit(main())
