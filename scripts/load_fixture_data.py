"""Load fixture data into an already-migrated database. For use on the server.

The counterpart to ``load_fixtures.py``, which can also build the schema itself from
``SQLModel.metadata``. That is useful locally and wrong here: a server database is built
by ``alembic upgrade head``, and a schema built from metadata instead would silently
diverge from the migrations — which is exactly the class of bug that put enum columns in
production where the ORM expected JSON. This script therefore only ever inserts rows.

Nothing here creates a table or seeds the ``tasks`` lookup; the migration owns both.

    docker compose exec -T web uv run python scripts/load_fixture_data.py

Pass a fixture path to load something other than the 2026-07 baselines. Refuses rather
than proceeding if the database is not at the migration head, or if it already holds
data — see the two checks below for why.
"""

import asyncio
import sys
from pathlib import Path

# Repo root on the path so ``tests.fixtures`` resolves regardless of the working
# directory this is invoked from — inside the container it is /app/app-brain-wide-bench,
# but `docker compose exec` does not guarantee that.
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import func, select

import app.models  # noqa: F401 — registers tables on SQLModel.metadata
from app.database import async_session_factory, engine
from app.models import Model, Submission, Team, User
from tests.fixtures.load import load_fixture

DEFAULT_FIXTURE = ROOT / "tests" / "fixtures" / "2026_07_baselines.json"

# Reported before and after so a run says what it actually changed, rather than only
# that it finished.
_COUNTED = {"teams": Team, "users": User, "models": Model, "submissions": Submission}


async def _current_revision() -> str | None:
    """The revision the database believes it is on, or None if never migrated."""
    async with engine.connect() as conn:
        return await conn.run_sync(
            lambda sync_conn: MigrationContext.configure(sync_conn).get_current_revision()
        )


def _head_revision() -> str:
    """The revision the code expects."""
    cfg = Config(str(ROOT / "alembic.ini"))
    # Set explicitly: alembic.ini's ``script_location`` is relative to the working
    # directory, which is not necessarily the repo root here.
    cfg.set_main_option("script_location", str(ROOT / "alembic"))
    return ScriptDirectory.from_config(cfg).get_current_head()


async def _counts(session) -> dict[str, int]:
    return {
        name: (await session.execute(select(func.count()).select_from(table))).scalar_one()
        for name, table in _COUNTED.items()
    }


async def main(fixture: Path) -> int:
    if not fixture.is_file():
        print(f"error: no such fixture: {fixture}", file=sys.stderr)
        return 2

    # ── Check 1: the database must be at head ────────────────────────────────
    #
    # Not politeness. The fixture inserts rows whose columns and enum labels come from
    # the current models, so loading it into a half-migrated schema fails partway and
    # leaves the data it already wrote behind.
    current, head = await _current_revision(), _head_revision()
    if current != head:
        where = f"at {current}" if current else "never migrated"
        print(
            f"error: database is {where}, but the code expects {head}.\n"
            f"       run `alembic upgrade head` first.",
            file=sys.stderr,
        )
        return 1

    async with async_session_factory() as session:
        # ── Check 2: refuse to load on top of existing data ──────────────────
        #
        # The fixture carries fixed names, and the schema enforces case-insensitive
        # uniqueness on team name, model name per team, and submission label per model.
        # A second run therefore dies on an IntegrityError partway through, having
        # already committed some rows. Refusing up front keeps that from happening on a
        # server, where recovering means restoring a dump.
        before = await _counts(session)
        if any(before.values()):
            summary = ", ".join(f"{n}={c}" for n, c in before.items() if c)
            print(
                f"error: database already holds data ({summary}).\n"
                f"       this script only loads into an empty database. to start over:\n"
                f'       psql -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"'
                f" && alembic upgrade head",
                file=sys.stderr,
            )
            return 1

        await load_fixture(session, fixture)
        after = await _counts(session)

    print(f"Loaded {fixture.name} into {engine.url.database} at revision {head}")
    for name, count in after.items():
        print(f"  {name:<12} {count}")
    return 0


if __name__ == "__main__":
    args = sys.argv[1:]
    path = Path(args[0]).resolve() if args else DEFAULT_FIXTURE
    raise SystemExit(asyncio.run(main(path)))
