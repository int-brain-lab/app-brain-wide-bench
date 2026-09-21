"""Rewrite existing ``task_scores`` rows from a fixture, matching on id.

The companion to ``load_fixture_data.py``, which only ever inserts. Re-scoring a submission
produces the same row ids from the same natural keys, so a regenerated fixture updates the
rows already in the database rather than colliding with them.

    docker compose exec -T web uv run python scripts/update_task_scores.py \\
        tests/fixtures/2026_09_baselines_overall.json

Reports and writes nothing unless ``--apply`` is passed. Refuses if any id in the fixture is
absent from the database, or if a mean moves by more than ``--max-mean-delta``: the same
predictions scored by the same code differ only in summation order, and a real change there
is a scoring change, not a re-score.

Only the four score columns are touched. Nothing else in the fixture is read.
"""

import argparse
import asyncio
import json
import sys
import uuid
from collections import Counter
from pathlib import Path

# Repo root on the path so ``app`` resolves regardless of the working directory this is
# invoked from — see load_fixture_data.py.
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from sqlalchemy import select  # noqa: E402 — after the path insert

import app.models  # noqa: E402, F401 — registers tables on SQLModel.metadata
from app.database import async_session_factory, engine  # noqa: E402
from app.models import TaskScore  # noqa: E402

# The columns a re-score rewrites. Everything else on the row is left as it stands.
FIELDS = ("n_seeds", "primary_metric_mean", "primary_metric_sem", "metrics")

# How many changed rows to print before summarising the rest.
SHOWN = 5


# ── Reading ────────────────────────────────────────────────────────────────────────────────────


def read_rows(fixture: Path) -> dict[uuid.UUID, dict]:
    """``{task_scores.id: row}`` from a fixture written by ``make_baselines.py``."""
    data = json.loads(fixture.read_text())

    return {uuid.UUID(row["id"]): row for row in data.get("task_scores", [])}


def changes(stored: TaskScore, row: dict) -> dict[str, tuple]:
    """``{field: (was, now)}`` for each of ``FIELDS`` the fixture changes."""
    edit = {}

    for field in FIELDS:
        was, now = getattr(stored, field), row.get(field)
        if was != now:
            edit[field] = (was, now)

    return edit


def mean_delta(stored: TaskScore, row: dict) -> float:
    """How far the fixture moves the row's primary mean. ``inf`` if one side is null."""
    was, now = stored.primary_metric_mean, row.get("primary_metric_mean")

    if was is None or now is None:
        return 0.0 if was == now else float("inf")

    return abs(was - now)


# ── Reporting ──────────────────────────────────────────────────────────────────────────────────


def _value(value) -> str:
    """One field as a line fits it: a metrics blob by size, a number as itself."""
    if isinstance(value, dict):
        return f"<{len(json.dumps(value))} bytes>"
    if isinstance(value, float):
        return f"{value:.6f}"

    return str(value)


def report(rows: dict, edits: dict, stored: dict) -> None:
    """Print what the fixture would change, per field and then row by row."""
    counts = Counter(field for edit in edits.values() for field in edit)

    carrying = sum(1 for row in rows.values() if (row.get("metrics") or {}).get("overall"))

    print(f"{len(rows)} task_scores row(s) in the fixture, all present in {engine.url.database}")
    print(f"  with overall  {carrying}")
    print(f"  unchanged     {len(rows) - len(edits)}")
    print(f"  to update     {len(edits)}")
    for field in FIELDS:
        print(f"      {field:<20} {counts.get(field, 0)}")

    if not edits:
        return

    print()
    for score_id, edit in list(edits.items())[:SHOWN]:
        print(f"  {score_id}  (task_submission {stored[score_id].task_submission_id})")
        for field, (was, now) in edit.items():
            print(f"    {field:<22} {_value(was)}  ->  {_value(now)}")

    if len(edits) > SHOWN:
        print(f"  ... and {len(edits) - SHOWN} more")


# ── Main ───────────────────────────────────────────────────────────────────────────────────────


async def main(args: argparse.Namespace) -> int:
    fixture = args.fixture.resolve()

    if not fixture.is_file():
        print(f"error: no such fixture: {fixture}", file=sys.stderr)
        return 2

    rows = read_rows(fixture)

    if not rows:
        print(f"error: {fixture.name} holds no task_scores", file=sys.stderr)
        return 2

    async with async_session_factory() as session:
        query = select(TaskScore).where(TaskScore.id.in_(list(rows)))
        found = (await session.execute(query)).scalars()
        stored = {score.id: score for score in found}

        if missing := sorted(str(score_id) for score_id in set(rows) - set(stored)):
            print(
                f"error: {len(missing)} of {len(rows)} id(s) are not in "
                f"{engine.url.database}, and nothing was written.\n"
                f"       first: {', '.join(missing[:3])}",
                file=sys.stderr,
            )
            return 1

        edits = {i: edit for i in rows if (edit := changes(stored[i], rows[i]))}

        report(rows, edits, stored)

        drifted = {i: mean_delta(stored[i], rows[i]) for i in rows}
        drifted = {i: d for i, d in drifted.items() if d > args.max_mean_delta}

        if drifted:
            worst = max(drifted.values())
            print(
                f"\nerror: {len(drifted)} mean(s) moved by more than {args.max_mean_delta:g} "
                f"(worst {worst:g}), and nothing was written.\n"
                f"       re-scoring the same predictions with the same code should not move a "
                f"mean; raise --max-mean-delta only once you know why this one does.",
                file=sys.stderr,
            )
            return 1

        if not args.apply:
            print("\nReport only. Pass --apply to write.")
            return 0

        if not edits:
            print("\nNothing to write.")
            return 0

        for score_id, edit in edits.items():
            for field, (_was, now) in edit.items():
                setattr(stored[score_id], field, now)

        await session.commit()

    print(f"\nUpdated {len(edits)} task_scores row(s) in {engine.url.database}")
    return 0


def parse() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__.split("\n\n")[0],
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("fixture", type=Path, help="Fixture holding the rewritten task_scores.")
    parser.add_argument("--apply", action="store_true", help="Write. Without it, report only.")
    parser.add_argument(
        "--max-mean-delta",
        type=float,
        default=1e-9,
        metavar="D",
        help="Refuse if any primary_metric_mean moves further than this.",
    )

    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main(parse())))
