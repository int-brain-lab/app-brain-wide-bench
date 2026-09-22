"""Re-score submitted runs from S3 and write the result as a ``task_scores`` fixture.

The bulk counterpart to the Re-score button: that one writes straight to the database, one
submission at a time. This reads the same files, scores them the same way, and writes a
fixture for ``scripts/update_task_scores.py`` to report on before anything is published.

    uv run python scripts/rescore_from_s3.py --dry-run
    uv run python scripts/rescore_from_s3.py --only mlp-ts1-rerun
    uv run python scripts/rescore_from_s3.py --snapshot tests/fixtures/rescored.json
    uv run python scripts/update_task_scores.py tests/fixtures/rescored.json

Runs one submission at a time. Each peaks at roughly twice the archive on disk — the zip
and the tree it unpacks to — so this wants the worker's scratch volume and its S3
credentials, not a laptop. ``TMPDIR`` chooses where that happens.

Smallest first, and the fixture is rewritten after every submission, so an interrupt keeps
what has already scored and ``--resume`` picks up the rest. ``--only`` re-scores the
submissions it names and keeps the rest of the fixture as it stands.

Submissions whose object is gone are listed and left alone: there is nothing to re-score,
and the row keeps the scores it has.
"""

import argparse
import asyncio
import json
import os
import shutil
import sys
import tempfile
import time
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from sqlalchemy import select  # noqa: E402 — after the path insert
from sqlalchemy.orm import selectinload  # noqa: E402

import app.models  # noqa: E402, F401 — registers tables on SQLModel.metadata
from app.database import async_session_factory, engine  # noqa: E402
from app.models import Submission, SubmissionStatus, Task, TaskSubmission  # noqa: E402
from app.scoring import get_scorer  # noqa: E402
from app.storage import download_ground_truth  # noqa: E402
from app.tasks.files import is_available, materialise  # noqa: E402

DEFAULT_SNAPSHOT = ROOT / "tests" / "fixtures" / "rescored_submissions.json"

# Free space a submission is not started without: the archive and the tree it unpacks to,
# with room to spare. ``file_size`` is null on rows written before it was recorded.
SCRATCH_FACTOR = 3
ASSUMED_SIZE = 10 * 1024**3


@dataclass
class Entry:
    """One submission to re-score, and the score rows the run rewrites."""

    submission_id: uuid.UUID
    label: str
    s3_key: str
    n_bytes: int

    # task id -> the id of the task_scores row holding that task's score.
    scores: dict[str, uuid.UUID] = field(default_factory=dict)

    @property
    def suites(self) -> list[str]:
        return sorted({task_id.split("-")[0] for task_id in self.scores})


def _size(n_bytes: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n_bytes < 1024 or unit == "GB":
            return f"{n_bytes:.0f} {unit}" if unit == "B" else f"{n_bytes:.1f} {unit}"
        n_bytes /= 1024

    return f"{n_bytes:.1f} TB"


# ── Reading ────────────────────────────────────────────────────────────────────────────────────


async def discover() -> tuple[list[Entry], dict[str, str]]:
    """Every scored submission with an object behind it, and each task's primary metric."""
    async with async_session_factory() as session:
        rows = (
            await session.execute(
                select(Submission)
                .options(
                    selectinload(Submission.task_submissions).selectinload(TaskSubmission.score)
                )
                .where(Submission.status == SubmissionStatus.done)
            )
        ).scalars()

        entries = []
        for submission in rows:
            scores = {
                entry.task_id: entry.score.id
                for entry in submission.task_submissions
                if entry.score is not None
            }

            if scores:
                entries.append(
                    Entry(
                        submission_id=submission.id,
                        label=submission.label,
                        s3_key=submission.s3_key,
                        n_bytes=submission.file_size or ASSUMED_SIZE,
                        scores=scores,
                    )
                )

        primary = dict((await session.execute(select(Task.id, Task.primary_metric))).all())

    return entries, {task_id: metric.value for task_id, metric in primary.items()}


def partition(entries: list[Entry]) -> tuple[list[Entry], list[Entry], list[Entry]]:
    """Split into what this run scores, what the baselines path owns, and what is gone."""
    scorable, local, missing = [], [], []

    for entry in entries:
        if Path(entry.s3_key).is_dir():
            local.append(entry)
        elif is_available(entry.s3_key):
            scorable.append(entry)
        else:
            missing.append(entry)

    return scorable, local, missing


def revive(snapshot: Path) -> dict[str, dict]:
    """The rows already in ``snapshot``, keyed by the label that produced them."""
    if not snapshot.exists():
        return {}

    data = json.loads(snapshot.read_text())
    by_label: dict[str, dict] = defaultdict(dict)

    for row in data.get("task_scores", []):
        by_label[row["_label"]][row["id"]] = row

    return dict(by_label)


# ── Scoring ────────────────────────────────────────────────────────────────────────────────────


def score(entry: Entry, primary: dict[str, str]) -> dict[str, dict]:
    """Score one submission and return its ``task_scores`` rows, keyed by row id."""
    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)

        gt_dir = download_ground_truth(entry.suites, tmpdir.joinpath("gt"))
        pred_dir = materialise(entry.s3_key, tmpdir)

        results: dict = {"rows": [], "overall": {}}
        for suite in entry.suites:
            scored = get_scorer(suite).score(pred_dir, gt_dir)
            results["rows"].extend(scored["rows"])
            results["overall"].update(scored["overall"])

    rows_by_task: dict[str, list] = defaultdict(list)
    for row in results["rows"]:
        rows_by_task[row["task"]].append(row)

    out = {}
    for task_id, score_id in sorted(entry.scores.items()):
        if task_id not in results["overall"]:
            print(f"    nothing scored for {task_id}; its row is left alone")
            continue

        metrics = results["overall"][task_id]
        headline = metrics[primary[task_id]]

        out[str(score_id)] = {
            "id": str(score_id),
            "n_seeds": headline["n"],
            "primary_metric_mean": headline["mean"],
            "primary_metric_sem": headline["sem"],
            "metrics": {"recordings": rows_by_task[task_id], "overall": metrics},
            # Which submission produced the row, so --resume knows what it already has.
            # update_task_scores.py reads the four columns above and ignores this.
            "_label": entry.label,
        }

    return out


def write(path: Path, by_label: dict[str, dict]) -> None:
    """Write the fixture through a temp file, so an interrupt cannot truncate a good one."""
    rows = [row for rows in by_label.values() for row in rows.values()]
    path.parent.mkdir(parents=True, exist_ok=True)

    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps({"task_scores": rows}, indent=2) + "\n")
    os.replace(tmp, path)


# ── Main ───────────────────────────────────────────────────────────────────────────────────────


def report(scorable: list[Entry], local: list[Entry], missing: list[Entry]) -> None:
    """Print the workload, and the two groups this run does not touch."""
    total = sum(entry.n_bytes for entry in scorable)
    print(f"\n{len(scorable)} submission(s) to score, {_size(total)} to download")

    if local:
        print(f"\n{len(local)} with a local directory as their key — these are the fixture")
        print("baselines; re-score them with make_baselines.py, not this:")
        for entry in local:
            print(f"    {entry.label}")

    if missing:
        print(f"\n{len(missing)} with no object in the bucket, left as they stand:")
        for entry in missing:
            print(f"    {entry.label:<32} {entry.s3_key}")


async def main(args: argparse.Namespace) -> int:
    entries, primary = await discover()

    if not entries:
        print(f"No scored submissions in {engine.url.database}.")
        return 0

    scorable, local, missing = partition(entries)

    if args.only:
        named = set(args.only)
        scorable = [entry for entry in scorable if entry.label in named]
        local = [entry for entry in local if entry.label in named]
        missing = [entry for entry in missing if entry.label in named]

        found = {entry.label for entry in (*scorable, *local, *missing)}
        for label in sorted(named - found):
            print(f"No scored submission labelled {label!r} in {engine.url.database}.")

    report(scorable, local, missing)

    if args.dry_run:
        print("\nDry run: nothing downloaded, nothing written.")
        return 0

    # --resume keeps what the fixture holds; --only keeps every submission it does not name,
    # so scoring one cannot empty a fixture the rest of the batch is already in.
    done = revive(args.snapshot) if args.resume or args.only else {}

    if args.only:
        done = {label: rows for label, rows in done.items() if label not in set(args.only)}

    pending = [entry for entry in scorable if entry.label not in done]
    pending.sort(key=lambda entry: entry.n_bytes)

    if kept := len(scorable) - len(pending):
        print(f"\nKeeping {kept} from {args.snapshot.name}; {len(pending)} to score.")

    failed = 0
    started = time.monotonic()

    for index, entry in enumerate(pending, start=1):
        print(f"\n[{index}/{len(pending)}] {entry.label}  ({_size(entry.n_bytes)})")

        free = shutil.disk_usage(tempfile.gettempdir()).free
        needed = entry.n_bytes * SCRATCH_FACTOR

        if free < needed:
            print(f"  SKIPPED: {_size(free)} free under TMPDIR, {_size(needed)} wanted")
            failed += 1
            continue

        try:
            done[entry.label] = score(entry, primary)
        except Exception as exc:  # noqa: BLE001 — one bad submission must not stop the batch
            print(f"  FAILED: {type(exc).__name__}: {exc}")
            failed += 1
            continue

        print(f"  {len(done[entry.label])} row(s) rescored")
        write(args.snapshot, done)

    write(args.snapshot, done)

    rows = sum(len(rows) for rows in done.values())
    minutes = (time.monotonic() - started) / 60
    print(f"\nscored={len(done)} failed={failed} rows={rows} in {minutes:.1f} min")
    print(f"Fixture: {args.snapshot}")
    print(f"Apply with: python scripts/update_task_scores.py {args.snapshot}")

    return 1 if failed else 0


def parse() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__.split("\n\n")[0],
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--snapshot", type=Path, default=DEFAULT_SNAPSHOT,
                        help="Where to write the fixture.")
    parser.add_argument("--only", action="append", default=[], metavar="LABEL",
                        help="Score this submission label, keeping every other row already "
                             "in the fixture. Repeatable.")
    parser.add_argument("--resume", action="store_true",
                        help="Keep what is already in the fixture; score only the rest.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Report the workload and write nothing.")

    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main(parse())))
