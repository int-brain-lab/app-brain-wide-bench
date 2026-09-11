"""Score the local baseline predictions and write the baselines fixture.

Metadata comes from ``bwb_models.json``, scores from the prediction files, and the result is
the flat shape ``tests/fixtures/load.py`` inserts. No database, no S3, no Celery.

Layout::

    <pred-root>/<submission-label>/<flat-task>/[<recording_id>/]seed_*.safetensors
    <gt-root>/<flat-task>/[<recording_id>/]ground_truth.safetensors

A submission's prediction directory is named after its label. Submissions the metadata
declares but the disk does not hold yet are listed and left out — re-run when they land.

Usage
-----
    uv run python scripts/make_baselines.py
    uv run python scripts/make_baselines.py --resume
    uv run python scripts/make_baselines.py --dry-run

``--resume`` keeps the scores already in the fixture and scores only what is new to it,
``--only <label>`` re-scores one submission and keeps the rest, ``--public`` publishes every
submission. The fixture is rewritten after each submission, so an interrupt keeps what has
already scored.

Every row is owned by one user, identified by its ``auth0_sub``. The default is the dev stub
from ``app/auth.py``, which dev mode signs every request in as and no real account can ever
hold. For a deployment, pass the sub a real account got at its first sign-in:

    uv run python scripts/make_baselines.py --public \\
        --owner-sub 'google-oauth2|1234…' --owner-email benchmark@internationalbrainlab.org

Load it with:

    uv run python scripts/load_fixture_data.py tests/fixtures/2026_09_baselines.json

Scoring needs the ``scoring`` extra (torch, safetensors); discovery does not.
"""

import argparse
import json
import os
import struct
import sys
import tempfile
import time
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.auth import DEV_SUB, parse_sub  # noqa: E402 — after the path insert
from app.models import (  # noqa: E402 — after the path insert
    Calibration,
    FinetuningStrategy,
    Modality,
    Model,
    SupervisionRegime,
    TaskSubmission,
    TrainingParadigm,
)
from app.scoring import get_scorer  # noqa: E402 — after the path insert
from tests.fixtures.load import _TASK_ROWS  # noqa: E402 — after the path insert

DEFAULT_DATA_ROOT = Path("~/Downloads/new_brainwidebench_data")
DEFAULT_SNAPSHOT = ROOT / "tests" / "fixtures" / "2026_09_baselines.json"

TEAM_NAME = "Brain Wide Bench"

# The owner row's display name, which a sign-in never overwrites — ``_upsert_user`` seeds
# ``name`` on insert only. Its email does keep syncing from the token.
OWNER_NAME = "Brain Wide Bench"
DEFAULT_OWNER_EMAIL = "benchmark@internationalbrainlab.org"

# One timestamp for the whole fixture, so a re-run is byte-identical.
CREATED_AT = "2026-09-10T00:00:00Z"

# Fixed namespace, so an id depends only on the natural key and not on when it was made.
_NS = uuid.uuid5(uuid.NAMESPACE_URL, "https://brainwidebench.org/baselines")

# Task ids the lookup table holds. A prediction for anything else has nowhere to hang.
TASK_IDS = {row["id"] for row in _TASK_ROWS}

# Metadata keys, derived from the columns they fill. Identity and ownership are the script's.
_MODEL_KEYS = set(Model.model_fields) - {"id", "team_id", "created_at"}
_SUBMISSION_KEYS = {"narrative_public", "narrative_private", "is_public", "is_deterministic"}
_TASKSUB_KEYS = set(TaskSubmission.model_fields) - {"id", "submission_id", "task_id"}

# Metadata fields holding an enum value or a list of them, by column name.
_ENUM_FIELDS = {
    "pretrained_in_modalities": Modality,
    "pretrained_out_modalities": Modality,
    "extra_input_modality": Modality,
    "training_paradigm": TrainingParadigm,
    "supervision_regime": SupervisionRegime,
    "calibration": Calibration,
    "finetuning_strategy": FinetuningStrategy,
}


def _id(*parts: str) -> uuid.UUID:
    """Deterministic row id from a natural key."""
    return uuid.uuid5(_NS, "/".join(parts))


def _size(n_bytes: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n_bytes < 1024 or unit == "GB":
            return f"{n_bytes:.0f} {unit}" if unit == "B" else f"{n_bytes:.1f} {unit}"
        n_bytes /= 1024
    return ""  # unreachable, but keeps the return type honest


# ── Metadata ───────────────────────────────────────────────────────────────────────────────────


@dataclass
class Entry:
    """One submission the metadata declares, and the prediction directory it names."""

    label: str
    model_name: str
    model: dict
    submission: dict
    task_submissions: dict[str, dict]
    directory: Path | None = None
    files: int = 0
    n_bytes: int = 0
    tasks_on_disk: set[str] = field(default_factory=set)

    @property
    def suites(self) -> list[str]:
        """The suites to run a scorer for, from the tasks the submission enters."""
        return sorted({task_id.split("-")[0] for task_id in self.task_submissions})


def _check_enum(cls, raw: str, where: str) -> str:
    """The value of ``cls`` matching ``raw`` by name or value, case-insensitively."""
    for member in cls:
        if raw.lower() in (member.name.lower(), member.value.lower()):
            return member.value
    allowed = ", ".join(member.value for member in cls)
    sys.exit(f"{where}: {raw!r} is not a {cls.__name__} — allowed: {allowed}")


def _check_fields(raw: dict, allowed: set[str], where: str) -> dict:
    """Metadata values as column values, enums normalised. Unknown keys are a hard error."""
    if unknown := sorted(set(raw) - allowed):
        sys.exit(
            f"Unknown metadata key(s) in {where}: {', '.join(unknown)}\n"
            f"Allowed: {', '.join(sorted(allowed))}"
        )

    fields = {}
    for key, value in raw.items():
        cls = _ENUM_FIELDS.get(key)
        if cls is None or value is None:
            fields[key] = value
        elif isinstance(value, list):
            fields[key] = [_check_enum(cls, item, f"{where}.{key}") for item in value]
        else:
            fields[key] = _check_enum(cls, value, f"{where}.{key}")
    return fields


def read_models(path: Path) -> list[Entry]:
    """Every submission the metadata file declares, in the order it declares them."""
    entries: list[Entry] = []
    labels: set[str] = set()

    for record in json.loads(path.read_text()):
        name = record["model"].get("name")
        if not name:
            sys.exit(f"{path.name}: a model has no name")
        model = _check_fields(record["model"], _MODEL_KEYS, f"{name}.model")

        for raw in record["submissions"]:
            label = raw["label"]
            if label in labels:
                sys.exit(f"{path.name}: {label!r} is used by two submissions")
            labels.add(label)

            tasks: dict[str, dict] = {}
            for entered in raw["task_submissions"]:
                fields = dict(entered)
                task_id = fields.pop("task")
                if task_id in tasks:
                    sys.exit(f"{label}: enters {task_id} twice")
                if task_id not in TASK_IDS:
                    sys.exit(f"{label}: {task_id} is not in the tasks lookup")
                tasks[task_id] = _check_fields(fields, _TASKSUB_KEYS, f"{label}.{task_id}")

            submission = _check_fields(
                {k: v for k, v in raw.items() if k not in ("label", "task_submissions")},
                _SUBMISSION_KEYS,
                label,
            )
            entries.append(Entry(label, name, model, submission, tasks))

    return entries


# ── Compatibility ──────────────────────────────────────────────────────────────────────────────

# The TS3 predictions name their task ts3-unit_cosmos and their unit ids entity_ids; the
# installed ibl_bwb_eval reads ts3-cosmos and unit_ids. Both aliases are no-ops once it agrees.
TASK_ALIASES = {"ts3-unit_cosmos": "ts3-cosmos"}
TENSOR_ALIASES = {"entity_ids": "unit_ids"}


def read_header(path: Path) -> dict:
    """A safetensors file's header without loading any tensor.

    The format is an 8-byte little-endian header length followed by that many bytes of JSON.
    """
    with path.open("rb") as fh:
        (header_len,) = struct.unpack("<Q", fh.read(8))
        if not 0 < header_len < 100_000_000:
            raise ValueError(f"implausible safetensors header length {header_len}")
        return json.loads(fh.read(header_len))


def alias_ground_truth(gt_root: Path, tmp: Path) -> Path:
    """A ground-truth tree carrying the aliased task names too. ``gt_root`` when none is missing."""
    aliased = {
        alias: gt_root / task
        for alias, task in TASK_ALIASES.items()
        if (gt_root / task).is_dir() and not (gt_root / alias).exists()
    }
    if not aliased:
        return gt_root

    tree = tmp / "gt"
    tree.mkdir(parents=True)
    for task in gt_root.iterdir():
        (tree / task.name).symlink_to(task)
    for alias, task in aliased.items():
        (tree / alias).symlink_to(task)

    print(f"  ground truth aliased: {', '.join(f'{a} → {t.name}' for a, t in aliased.items())}")
    return tree


def alias_predictions(directory: Path, tmp: Path) -> Path:
    """A copy of ``directory`` with aliased tensor keys renamed. ``directory`` when none are."""
    from safetensors import safe_open
    from safetensors.torch import load_file, save_file

    paths = sorted(directory.rglob("seed_*.safetensors"))
    stale = {path for path in paths if set(read_header(path)) & set(TENSOR_ALIASES)}
    if not stale:
        return directory

    renamed = ", ".join(f"{old} → {new}" for old, new in TENSOR_ALIASES.items())
    print(f"  tensor keys aliased in {len(stale)} file(s): {renamed}")

    root = tmp / "pred" / directory.name
    for path in paths:
        dest = root / path.relative_to(directory)
        dest.parent.mkdir(parents=True, exist_ok=True)
        if path not in stale:
            dest.symlink_to(path)
            continue
        tensors = load_file(str(path))
        for old, new in TENSOR_ALIASES.items():
            if old in tensors:
                tensors[new] = tensors.pop(old)
        with safe_open(str(path), framework="pt") as fh:
            metadata = fh.metadata()
        save_file(tensors, str(dest), metadata=metadata)

    return root


# ── Discovery ──────────────────────────────────────────────────────────────────────────────────


def discover(entries: list[Entry], pred_root: Path) -> None:
    """Attach the prediction directory, its file count and its size to every entry that has one."""
    for entry in entries:
        directory = pred_root / entry.label
        paths = sorted(directory.rglob("seed_*.safetensors")) if directory.is_dir() else []
        if not paths:
            continue

        entry.directory = directory
        entry.files = len(paths)
        entry.n_bytes = sum(path.stat().st_size for path in paths)
        entry.tasks_on_disk = {
            TASK_ALIASES.get(task.name, task.name) for task in directory.iterdir() if task.is_dir()
        }


def report(entries: list[Entry], pred_root: Path) -> list[Entry]:
    """Print what is on disk against what the metadata declares. Returns the available entries."""
    available = [entry for entry in entries if entry.directory is not None]
    known = {entry.label for entry in entries}

    for entry in sorted(available, key=lambda e: e.n_bytes):
        print(
            f"  {entry.model_name:<24} {entry.label:<44} "
            f"{len(entry.task_submissions)} task(s), {entry.files} file(s), {_size(entry.n_bytes)}"
        )
        if missing := sorted(set(entry.task_submissions) - entry.tasks_on_disk):
            print(f"      declared but not on disk: {', '.join(missing)}")
        if extra := sorted(entry.tasks_on_disk - set(entry.task_submissions)):
            print(f"      on disk but not declared: {', '.join(extra)}")

    if waiting := [entry.label for entry in entries if entry.directory is None]:
        print(f"\n  no prediction directory yet ({len(waiting)}):")
        for label in waiting:
            print(f"      {label}")

    if stray := sorted(d.name for d in pred_root.iterdir() if d.is_dir() and d.name not in known):
        print(f"\n  not in the metadata, ignored: {', '.join(stray)}")

    return available


# ── Scoring ────────────────────────────────────────────────────────────────────────────────────


def score(entry: Entry, gt_root: Path, tmp: Path) -> dict:
    """Score one submission, one scorer per suite it enters. Empty summary when nothing matched.

    Task ids are unique across suites, so merging the per-suite summaries cannot collide.
    """
    results: dict = {"rows": [], "summary": {}}
    pred_dir = alias_predictions(entry.directory, tmp)
    started = time.monotonic()

    for suite in entry.suites:
        try:
            scored = get_scorer(suite).score(pred_dir, gt_root)
        except ModuleNotFoundError as exc:
            sys.exit(f"\nScoring code not importable ({exc}).\nInstall the scoring extra: uv sync")
        except Exception as exc:  # noqa: BLE001 — one bad baseline must not stop the batch
            print(f"  {suite} FAILED: {type(exc).__name__}: {exc}")
            continue
        results["rows"].extend(scored["rows"])
        results["summary"].update(scored["summary"])

    elapsed = time.monotonic() - started
    if not results["summary"]:
        print(f"  FAILED after {elapsed:.0f}s: no prediction/ground-truth pairs matched")
        return results

    print(f"  scored in {elapsed:.0f}s")
    for task_id, stats in sorted(results["summary"].items()):
        sem = f" ± {stats['sem']:.4f}" if stats.get("sem") is not None else ""
        print(f"    {task_id:<32} {stats['mean']:.4f}{sem}  ({stats['n']} recording(s))")
    if missing := sorted(set(entry.task_submissions) - set(results["summary"])):
        print(f"    nothing scored for: {', '.join(missing)}")

    return results


def revive(snapshot: Path) -> dict[str, dict]:
    """The scores already in ``snapshot``, keyed by submission label, in the scorer's shape."""
    if not snapshot.exists():
        return {}

    data = json.loads(snapshot.read_text())
    label_of = {row["id"]: row["label"] for row in data.get("submissions", [])}
    entered = {
        row["id"]: (label_of[row["submission_id"]], row["task_id"])
        for row in data.get("task_submissions", [])
        if row["submission_id"] in label_of
    }

    results: dict[str, dict] = defaultdict(lambda: {"rows": [], "summary": {}})
    for row in data.get("task_scores", []):
        if row["task_submission_id"] not in entered:
            continue
        label, task_id = entered[row["task_submission_id"]]
        results[label]["summary"][task_id] = {
            "mean": row["primary_metric_mean"],
            "sem": row["primary_metric_sem"],
            "n": row["n_seeds"],
        }
        results[label]["rows"].extend(row.get("metrics", {}).get("recordings", []))

    return dict(results)


# ── Fixture ────────────────────────────────────────────────────────────────────────────────────


def _readme(path: Path) -> str:
    """The note at the top of the fixture, naming the file it belongs to."""
    return (
        "Generated by scripts/make_baselines.py from the local baseline predictions and "
        "bwb_models.json. Replay with: python scripts/load_fixture_data.py "
        f"tests/fixtures/{path.name}"
    )


def owner_row(sub: str, email: str) -> dict:
    """The user row every baseline is owned by, identified by ``sub``.

    ``provider`` and ``orcid_id`` follow the sub the way ``app.auth.parse_sub`` derives them
    at sign-in, so the row a real account later signs in to already matches.
    """
    provider, orcid_id = parse_sub(sub)
    return {
        "id": str(_id("user", sub)),
        "created_at": CREATED_AT,
        "auth0_sub": sub,
        "email": email,
        "name": OWNER_NAME,
        "provider": provider,
        "orcid_id": orcid_id,
        "affiliation": TEAM_NAME,
    }


def build(available: list[Entry], scored: dict[str, dict], snapshot: Path, owner: dict) -> dict:
    """The whole fixture, tables in the order ``tests/fixtures/load.py`` inserts them.

    An entry absent from ``scored`` keeps its task rows, unscored, and marks its submission
    failed; so does one whose scorer covered only part of the tasks it enters.
    """
    team_id = _id("team", TEAM_NAME.lower())
    user_id = owner["id"]

    data: dict = {
        "_readme": _readme(snapshot),
        "teams": [{"id": str(team_id), "name": TEAM_NAME}],
        "users": [owner],
        "user_teams": [{"user_id": user_id, "team_id": str(team_id), "role": "owner"}],
        "models": [],
        "submissions": [],
        "submission_users": [],
        "task_submissions": [],
        "task_scores": [],
    }

    seen: set[str] = set()
    for entry in available:
        model_id = _id("model", str(team_id), entry.model_name)
        if entry.model_name not in seen:
            seen.add(entry.model_name)
            data["models"].append(
                {
                    "id": str(model_id),
                    "team_id": str(team_id),
                    **entry.model,
                    "created_at": CREATED_AT,
                }
            )

        results = scored.get(entry.label, {})
        summary = results.get("summary", {})
        submission_id = _id("submission", str(model_id), entry.label.lower())
        data["submissions"].append(
            {
                "id": str(submission_id),
                "model_id": str(model_id),
                "label": entry.label,
                "status": "done" if set(entry.task_submissions) <= set(summary) else "failed",
                # Where the predictions were read from; nothing parses it.
                "s3_key": str(entry.directory),
                **entry.submission,
                "created_at": CREATED_AT,
                "updated_at": CREATED_AT,
            }
        )
        data["submission_users"].append(
            {"submission_id": str(submission_id), "user_id": user_id, "role": "owner"}
        )

        recordings_per_task: dict[str, list[dict]] = defaultdict(list)
        for row in results.get("rows", []):
            recordings_per_task[row["task"]].append(row)

        for task_id, fields in sorted(entry.task_submissions.items()):
            entry_id = _id("tasksub", str(submission_id), task_id)
            data["task_submissions"].append(
                {
                    "id": str(entry_id),
                    "submission_id": str(submission_id),
                    "task_id": task_id,
                    **fields,
                }
            )

            if task_id not in summary:
                continue

            data["task_scores"].append(
                {
                    "id": str(_id("taskscore", str(entry_id))),
                    "task_submission_id": str(entry_id),
                    # Recordings behind the mean; each recording's own n is its seeds.
                    "n_seeds": summary[task_id]["n"],
                    "primary_metric_mean": summary[task_id]["mean"],
                    "primary_metric_sem": summary[task_id]["sem"],
                    "metrics": {"recordings": recordings_per_task[task_id]},
                }
            )

    return data


def write(path: Path, data: dict) -> None:
    """Write the fixture through a temp file, so an interrupt cannot truncate a good one."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2) + "\n")
    os.replace(tmp, path)


# ── Main ───────────────────────────────────────────────────────────────────────────────────────


def main(args: argparse.Namespace) -> int:
    data_root = args.data_root.expanduser().resolve()
    pred_root = (args.pred_root or data_root / "baselines").expanduser().resolve()
    gt_root = (args.gt_root or data_root / "ground_truth").expanduser().resolve()
    metadata = (args.metadata or data_root / "bwb_models.json").expanduser().resolve()

    for name, path in (("Prediction root", pred_root), ("Ground-truth root", gt_root)):
        if not path.is_dir():
            sys.exit(f"{name} not found: {path}")
    if not metadata.is_file():
        sys.exit(f"Metadata not found: {metadata}")

    entries = read_models(metadata)
    if args.public:
        for entry in entries:
            entry.submission["is_public"] = True

    owner = owner_row(args.owner_sub, args.owner_email)
    print(f"Owner: {owner['email']}  {owner['auth0_sub']}  (provider {owner['provider']})")
    print(f"{len(entries)} submission(s) in {metadata.name}; looking under {pred_root}\n")
    discover(entries, pred_root)
    available = report(entries, pred_root)
    if not available:
        sys.exit("\nNo prediction directory matched a declared submission.")

    print(f"\n{len(available)} of {len(entries)} submission(s) available.")
    if args.dry_run:
        print("Dry run: nothing written.")
        return 0

    # --only re-scores what it names and keeps every other submission's scores, so a
    # single-submission run cannot empty the fixture.
    only = set(args.only)
    scored = revive(args.snapshot) if args.resume or only else {}
    if only:
        scored = {label: results for label, results in scored.items() if label not in only}
        pending = [entry for entry in available if entry.label in only]
    else:
        pending = [entry for entry in available if entry.label not in scored]

    pending.sort(key=lambda entry: entry.n_bytes)
    if kept := len(available) - len(pending):
        print(f"Keeping {kept} score(s) from {args.snapshot.name}; {len(pending)} to score.")

    failed = 0
    started = time.monotonic()
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        gt_root = alias_ground_truth(gt_root, tmp)

        for index, entry in enumerate(pending, start=1):
            print(f"\n[{index}/{len(pending)}] {entry.label}  "
                  f"({entry.files} files, {_size(entry.n_bytes)})")
            results = score(entry, gt_root, tmp)
            if results["summary"]:
                scored[entry.label] = results
            else:
                failed += 1
            # After every submission, so an interrupt hours in keeps what already scored.
            write(args.snapshot, build(available, scored, args.snapshot, owner))

    write(args.snapshot, build(available, scored, args.snapshot, owner))
    print(f"\nscored={len(scored)} failed={failed} in {(time.monotonic() - started) / 60:.1f} min")
    if not any(entry.submission.get("is_public") for entry in available):
        print("Every submission is private — pass --public to show them to signed-out visitors.")
    print(f"Fixture: {args.snapshot}")
    return 1 if failed else 0


def parse() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__.split("\n\n")[0],
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--data-root", type=Path, default=DEFAULT_DATA_ROOT,
                        help="Holds baselines/, ground_truth/ and bwb_models.json.")
    parser.add_argument("--pred-root", type=Path, help="Overrides <data-root>/baselines.")
    parser.add_argument("--gt-root", type=Path, help="Overrides <data-root>/ground_truth.")
    parser.add_argument("--metadata", type=Path, help="Overrides <data-root>/bwb_models.json.")
    parser.add_argument("--snapshot", type=Path, default=DEFAULT_SNAPSHOT,
                        help="Where to write the fixture.")
    parser.add_argument("--only", action="append", default=[], metavar="LABEL",
                        help="Re-score this submission label and keep the rest. Repeatable.")
    parser.add_argument("--resume", action="store_true",
                        help="Keep the scores already in the fixture; score only what is new.")
    parser.add_argument("--public", action="store_true",
                        help="Publish every submission, whatever the metadata says.")
    parser.add_argument("--owner-sub", default=DEV_SUB, metavar="SUB",
                        help="Auth0 sub the owner row carries. The default is the dev stub, "
                             "which no real account can ever sign in as.")
    parser.add_argument("--owner-email", default=DEFAULT_OWNER_EMAIL, metavar="EMAIL",
                        help="Email on the owner row. Must be the one that sub signs in with.")
    parser.add_argument("--dry-run", action="store_true", help="Report and write nothing.")
    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(main(parse()))
