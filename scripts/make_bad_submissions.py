"""Generate one submission zip per validation failure, and the ground truth they are checked
against.

    uv run python scripts/make_bad_submissions.py --out ~/bwb-bad-submissions

Writes ``<out>/ground_truth/`` and one ``<out>/<code>.zip`` per failure. Point the API at the
ground truth and upload the zips one at a time:

    S3_GT_PREFIX=<out>/ground_truth

Every zip is validated after it is written, so the table printed at the end is what the API
will actually report rather than what this script intended. A case that reports more than its
own code is usually honest — one broken file can fail two checks — and the intended code is
listed first.

``tests/fixtures/submissions.py`` is the ts1-only sibling of the writers below, kept separate
because the test suite wants one tiny valid pair rather than breadth.

Not produced: E999 (an internal error, not a property of any file) and E108, which needs
``MIN_DATASET_VERSION`` / ``MAX_DATASET_VERSION`` configured to bite — its zip is written
anyway, carrying version 9.9.9.
"""

import argparse
import shutil
import sys
import zipfile
from collections import Counter
from pathlib import Path

import torch
from safetensors import safe_open
from safetensors.torch import load_file, save_file

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ibl_bwb_eval._unit_ids import _UID_LEN, encode_unit_ids
from ibl_bwb_eval.tasks import get_ts3_readout_spec

from app.validation.validate_submission import validate_folder

LABEL = "mlp-baseline"
SEEDS = (1, 2, 3)
VERSION = "1.0.0"

TS1_TASK = "ts1-reward"
TS1_DIMS = 2
TS1_TRIALS = 4
TS1_RECORDINGS = ("rec1", "rec2")

TS2_TASK = "ts2-co_smoothing"
TS2_RECORDING = "rec1"
TS2_WINDOWS, TS2_STEPS, TS2_UNITS = 3, 2, 4

TS3_TASK = "ts3-cosmos"
TS3_ROWS = 5
TS3_LABELS = get_ts3_readout_spec("cosmos").label_names


# ── Writing a valid submission ────────────────────────────────────────────────


def _ids(prefix: str, count: int) -> torch.Tensor:
    """Encode ``count`` ids, NUL-padded to the width the decoder expects.

    A plain list, not an ndarray: numpy strips trailing NULs from fixed-width unicode, and
    the padding is exactly what makes every id the same length.
    """
    return encode_unit_ids([f"{prefix}{n}".ljust(_UID_LEN, "\0") for n in range(count)])


def _write(path: Path, tensors: dict, metadata: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    save_file(tensors, str(path), metadata={k: str(v) for k, v in metadata.items()})


def _common(task: str, seed: int, unit_filtering: str, **extra) -> dict:
    return {
        "label": LABEL,
        "task": task,
        "seed": seed,
        "unit_filtering": unit_filtering,
        "dataset_version": VERSION,
        **extra,
    }


def write_ts1(pred: Path, gt: Path) -> None:
    """One sequence-level task over two recordings, with the trial ids it is scored on."""
    trial_id = torch.arange(TS1_TRIALS, dtype=torch.int64)

    for recording in TS1_RECORDINGS:
        for seed in SEEDS:
            _write(
                pred / LABEL / TS1_TASK / recording / f"seed_{seed}.safetensors",
                {"predictions": torch.zeros(TS1_TRIALS, 1, TS1_DIMS), "trial_id": trial_id},
                _common(TS1_TASK, seed, "all_units", recording_id=recording),
            )

        _write(
            gt / TS1_TASK / recording / "ground_truth.safetensors",
            {
                "trial_id": trial_id,
                # Both classes present, so a balanced accuracy over them is defined.
                "values": (torch.arange(TS1_TRIALS, dtype=torch.int64) % TS1_DIMS).reshape(-1, 1),
            },
            {},
        )


def write_ts2(pred: Path, gt: Path) -> None:
    """A windowed firing-rate task. ts2 requires ``selected_units``."""
    timestamps = torch.arange(TS2_WINDOWS, dtype=torch.float32)
    unit_ids = _ids("unit", TS2_UNITS)

    for seed in SEEDS:
        _write(
            pred / LABEL / TS2_TASK / TS2_RECORDING / f"seed_{seed}.safetensors",
            {
                "predictions": torch.zeros(TS2_WINDOWS, TS2_STEPS, TS2_UNITS),
                "window_timestamps": timestamps,
                "unit_ids": unit_ids,
            },
            _common(TS2_TASK, seed, "selected_units", recording_id=TS2_RECORDING),
        )

    _write(
        gt / TS2_TASK / TS2_RECORDING / "ground_truth.safetensors",
        {"window_timestamps": timestamps, "unit_ids": unit_ids},
        {},
    )


def write_ts3(pred: Path, gt: Path) -> None:
    """Whole-population classification: no recording level, and a fixed label order."""
    entity_ids = _ids("entity", TS3_ROWS)

    for seed in SEEDS:
        _write(
            pred / LABEL / TS3_TASK / f"seed_{seed}.safetensors",
            {"pred_proba": torch.zeros(TS3_ROWS, len(TS3_LABELS)), "entity_ids": entity_ids},
            _common(TS3_TASK, seed, "selected_units", label_names=",".join(TS3_LABELS)),
        )

    _write(gt / TS3_TASK / "ground_truth.safetensors", {"entity_ids": entity_ids}, {})


def write_valid(root: Path) -> tuple[Path, Path]:
    """Write a submission that passes every check, and its ground truth."""
    pred, gt = root / "pred", root / "gt"

    write_ts1(pred, gt)
    write_ts2(pred, gt)
    write_ts3(pred, gt)

    return pred, gt


# ── Breaking it, one way at a time ────────────────────────────────────────────


def ts1_file(pred: Path, recording: str = "rec1", seed: int = 1) -> Path:
    return pred / LABEL / TS1_TASK / recording / f"seed_{seed}.safetensors"


def edit(path: Path, tensors: dict | None = None, metadata: dict | None = None) -> None:
    """Rewrite one file with tensor and metadata overrides. A ``None`` value drops a key."""
    with safe_open(str(path), framework="pt") as f:
        existing_meta = dict(f.metadata() or {})

    existing = load_file(str(path))
    existing.update(tensors or {})

    existing_meta.update(metadata or {})
    kept = {k: v for k, v in existing_meta.items() if v is not None}

    save_file(existing, str(path), metadata=kept)


def drop_metadata(key: str):
    return lambda pred: edit(ts1_file(pred), metadata={key: None})


def set_metadata(**pairs):
    return lambda pred: edit(ts1_file(pred), metadata=pairs)


def drop_recording(recording: str):
    return lambda pred: shutil.rmtree(pred / LABEL / TS1_TASK / recording)


def reseed(seeds: tuple[int, ...], recordings: tuple[str, ...] = TS1_RECORDINGS):
    """Replace each recording's seed files with ``seeds``, keeping their contents.

    Every recording by default: leaving one alone makes the seed *sets* disagree, which is
    E103 — checked before the count and contiguity rules and short-circuiting both.
    """

    def apply(pred: Path) -> None:
        for recording in recordings:
            base = pred / LABEL / TS1_TASK / recording
            source = ts1_file(pred, recording)

            template = load_file(str(source))
            with safe_open(str(source), framework="pt") as f:
                metadata = dict(f.metadata() or {})

            for existing in sorted(base.glob("seed_*.safetensors")):
                existing.unlink()

            for seed in seeds:
                save_file(
                    template,
                    str(base / f"seed_{seed}.safetensors"),
                    metadata=metadata | {"seed": str(seed)},
                )

    return apply


def relabel_tree(source: str, destination: str, **metadata):
    """Copy a directory and bring the copies' metadata into line with where they now sit."""

    def apply(pred: Path) -> None:
        shutil.copytree(pred / source, pred / destination)

        for path in sorted((pred / destination).rglob("seed_*.safetensors")):
            edit(path, metadata=metadata)

    return apply


# Provokable only with settings this script cannot reach.
CONDITIONAL = {"E108"}

# Every case: the code it is written to provoke, why, and what it does to a valid tree.
CASES = [
    ("valid", "nothing wrong with it", lambda pred: None),
    ("E001", "a required metadata field is missing", drop_metadata("unit_filtering")),
    ("E002", "unit_filtering outside the known set", set_metadata(unit_filtering="whatever")),
    ("E003", "dataset_version not x.y.z", set_metadata(dataset_version="1.0")),
    (
        "E004",
        "a file meant to be a seed file, misnamed",
        lambda pred: shutil.copy(ts1_file(pred), ts1_file(pred).with_name("seed_x.safetensors")),
    ),
    (
        "E005",
        "an unrecognised task id in the path",
        lambda pred: (pred / LABEL / TS1_TASK).rename(pred / LABEL / "ts1-nosuchtask"),
    ),
    (
        "E006",
        "ts1 predictions not 3D",
        lambda pred: edit(ts1_file(pred), {"predictions": torch.zeros(TS1_TRIALS, TS1_DIMS)}),
    ),
    (
        "E007",
        "ts2 predictions not 3D",
        lambda pred: edit(
            pred / LABEL / TS2_TASK / TS2_RECORDING / "seed_1.safetensors",
            {"predictions": torch.zeros(TS2_WINDOWS, TS2_UNITS)},
        ),
    ),
    (
        "E008",
        "ts2 window_timestamps repeat",
        lambda pred: edit(
            pred / LABEL / TS2_TASK / TS2_RECORDING / "seed_1.safetensors",
            {"window_timestamps": torch.zeros(TS2_WINDOWS)},
        ),
    ),
    (
        "E009",
        "ts3 pred_proba class dim disagrees with label_names",
        lambda pred: edit(
            pred / LABEL / TS3_TASK / "seed_1.safetensors",
            {"pred_proba": torch.zeros(TS3_ROWS, 3)},
        ),
    ),
    (
        "E010",
        "ts3 label_names out of order",
        lambda pred: edit(
            pred / LABEL / TS3_TASK / "seed_1.safetensors",
            metadata={"label_names": ",".join(reversed(TS3_LABELS))},
        ),
    ),
    (
        "E011",
        "a recording the ground truth has never heard of",
        relabel_tree(f"{LABEL}/{TS1_TASK}/rec1", f"{LABEL}/{TS1_TASK}/rec9", recording_id="rec9"),
    ),
    (
        "E012",
        "trial ids that do not line up with the ground truth",
        lambda pred: edit(
            ts1_file(pred), {"trial_id": torch.arange(100, 100 + TS1_TRIALS, dtype=torch.int64)}
        ),
    ),
    ("E013", "metadata disagreeing with the path it sits at", set_metadata(label="someone-else")),
    (
        "E014",
        "a file that is not part of the layout",
        lambda pred: (pred / LABEL / "notes.md").write_text("hello"),
    ),
    ("E101", "fewer seeds than a task needs", reseed((1,))),
    ("E102", "seeds with a gap in them", reseed((1, 2, 9))),
    ("E103", "recordings of one task disagreeing on seeds", reseed((7, 8, 9), ("rec2",))),
    ("E104", "a required session missing", drop_recording("rec2")),
    (
        "E105",
        "the same seed twice, spelled differently",
        lambda pred: shutil.copy(ts1_file(pred), ts1_file(pred).with_name("seed_01.safetensors")),
    ),
    (
        "E106",
        "two labels in one submission",
        relabel_tree(LABEL, "another-label", label="another-label"),
    ),
    (
        "E107",
        "predictions that are not finite",
        lambda pred: edit(
            ts1_file(pred), {"predictions": torch.full((TS1_TRIALS, 1, TS1_DIMS), float("nan"))}
        ),
    ),
    ("E108", "a dataset version outside the accepted range", set_metadata(dataset_version="9.9.9")),
    (
        "E109",
        "ts2 without the unit filtering its suite requires",
        lambda pred: edit(
            pred / LABEL / TS2_TASK / TS2_RECORDING / "seed_1.safetensors",
            metadata={"unit_filtering": "all_units"},
        ),
    ),
]


# ── Assembling ────────────────────────────────────────────────────────────────


def zip_tree(pred: Path, destination: Path) -> None:
    """Zip the tree so its label directory is at the archive root."""
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(pred.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(pred).as_posix())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True, help="Directory to write into.")
    args = parser.parse_args()

    out = args.out.expanduser()
    build = out / ".build"

    shutil.rmtree(build, ignore_errors=True)
    shutil.rmtree(out / "ground_truth", ignore_errors=True)

    # The ground truth is written once, from a pristine tree, and every zip is checked
    # against it — which is how the API will see them.
    _, gt = write_valid(build / "reference")
    shutil.move(str(gt), str(out / "ground_truth"))

    rows = []

    for code, why, mutate in CASES:
        root = build / code
        pred, _ = write_valid(root)
        shutil.rmtree(root / "gt")

        mutate(pred)

        destination = out / f"{code}.zip"
        zip_tree(pred, destination)

        result = validate_folder(pred, out / "ground_truth")
        found = Counter(finding.code for finding in result.errors)
        ordered = [code] if code in found else []
        ordered += sorted(c for c in found if c != code)

        reports = ", ".join(f"{c}×{found[c]}" for c in ordered) or "—"
        rows.append((destination.name, code, reports, why))

    shutil.rmtree(build, ignore_errors=True)

    width = max(len(name) for name, *_ in rows)
    print(f"\nground truth: {out / 'ground_truth'}\n")
    print(f"{'zip'.ljust(width)}  {'wanted':7}  {'reports':10}  why")
    print("-" * (width + 60))

    for name, wanted, found, why in rows:
        if wanted in CONDITIONAL:
            flag = "  (needs the version bounds configured)"
        elif wanted == "valid" or wanted in found:
            flag = ""
        else:
            flag = "  !"

        print(f"{name.ljust(width)}  {wanted:7}  {found:10}  {why}{flag}")

    print("\n! = the intended code did not fire, which means this script is wrong.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
