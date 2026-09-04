"""Shared fixtures for in-process API tests.

These run the FastAPI app against an in-memory async SQLite database with the S3
and Celery side-effects stubbed out — no containers, no Postgres, no Redis, no AWS.
"""

import json
import uuid
from pathlib import Path

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel

import app.models  # noqa: F401 — register tables on SQLModel.metadata
import app.routers.meta as meta_router
import app.routers.submissions as submissions_router
from app.config import settings
from app.database import get_session
from app.main import app
from tests.fixtures.load import load_fixture, seed_tasks

FIXTURE_PATH = Path(__file__).parent.joinpath("fixtures", "api_tests.json")


@pytest_asyncio.fixture
async def engine():
    """In-memory async SQLite engine with the full schema created."""
    eng = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with eng.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    yield eng
    await eng.dispose()


@pytest_asyncio.fixture
async def session_factory(engine):
    """Session factory bound to the test engine."""
    return async_sessionmaker(engine, expire_on_commit=False)


@pytest_asyncio.fixture
async def client(engine, session_factory, monkeypatch):
    """HTTP client against the ASGI app with DB, S3 and Celery stubbed."""

    async def override_get_session():
        async with session_factory() as session:
            yield session

    # Force the stub auth backend. Without this the suite reads whatever AUTH0_DOMAIN the
    # developer has in .env, and every authenticated request 401s on a machine configured
    # against a real tenant.
    monkeypatch.setattr(settings, "auth0_domain", "dev")

    # /api/meta caches its document for the life of the process; each test has its own
    # database, so a cache surviving between them would serve the first test's task table
    # to every test after it.
    meta_router.reset_meta_document()

    app.dependency_overrides[get_session] = override_get_session
    monkeypatch.setattr(
        submissions_router, "presign_put", lambda key, content_type="application/zip": f"https://s3.test/{key}"
    )
    monkeypatch.setattr(submissions_router.score_submission, "delay", lambda *a, **k: None)

    # Seed static task lookup (normally done by the Alembic migration).
    async with session_factory() as s:
        await seed_tasks(s)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c

    app.dependency_overrides.clear()
    meta_router.reset_meta_document()


@pytest_asyncio.fixture
async def seeded_client(client, session_factory):
    """HTTP client with the full api_tests fixture pre-loaded."""
    async with session_factory() as s:
        await load_fixture(s, FIXTURE_PATH)
    return client


# ── Fixture data ──────────────────────────────────────────────────────────────
#
# What tests/fixtures/api_tests.json contains. Three teams, chosen so that the answer
# to "may the caller see this" differs between them:
#
#   Brain Wide Bench — 2 members, 2 models, 5 submissions, 12 ts1 / 2 ts2 / 1 ts3 tasks
#     members    benchmark@ (owner), collaborator@ (collaborator)
#     mlp-baseline                       not pretrained
#       mlp-ts1-baseline    public   done      8 ts1 tasks, all scored
#       mlp-ts1-rerun       private  done      2 ts1 tasks, scored
#       mlp-ts1-queued      private  pending   2 ts1 tasks, no scores yet
#       mlp-ts3-internal    private  done      1 ts3 task, scored
#     ssl-transformer                    pretrained, both modality lists populated
#       ssl-ts2-pilot       private   done      2 ts2 tasks, scored
#
#   Int Brain Lab — 1 member, 1 model, 0 submissions
#     members    collaborator@ (owner)
#     unsubmitted-net                    no submissions at all
#
#   Cortex Lab — 1 member, 0 models, 0 submissions
#     members    outsider@ (owner)
#
# The combinations that buys you: public vs private, scored vs unscored, done vs pending,
# pretrained vs not, a model nobody has submitted to, and a team with no models.
# collaborator@ belongs to two teams, so "the caller's role" is a real question rather
# than a constant; outsider@ belongs to neither of the first two, so it stands in for
# someone who must be refused.
#
# mlp-baseline is the one to reach for when a rule spans suites *and* visibility: its ts1
# submission is public and its ts3 one isn't, so the suites it reports depend on who is
# asking — ["ts1"] to an outsider, ["ts1", "ts3"] to a member. ssl-transformer is the
# simple case by contrast: one public submission, one suite, the same answer for everyone.
#
# submission_users carries an owner for each submission and a collaborator on
# mlp-ts1-baseline — note those links currently grant no access on their own, since the
# submission routes authorise by team membership.
#
# None of these users is the caller. In dev mode the caller is a stub user who belongs to
# nothing, which is what makes the non-member path the default and keeps the visibility
# tests honest — a test that wants membership joins a team explicitly with ``add``.
#
# Users are keyed by email, the identifier the API itself takes; the rest by their
# display name (a submission's is its ``label``).

_ROWS = json.loads(FIXTURE_PATH.read_text())

# Which column names each table — a submission's is its ``label``, a user's its email.
_KEY = {"teams": "name", "users": "email", "models": "name", "submissions": "label"}


def _rows_by(table: str) -> dict[str, dict]:
    return {row[_KEY[table]]: row for row in _ROWS[table]}


# The rows themselves, for a test that asserts the API echoes a record back in full.
TEAM_ROWS = _rows_by("teams")
USER_ROWS = _rows_by("users")
MODEL_ROWS = _rows_by("models")
SUBMISSION_ROWS = _rows_by("submissions")

TEAMS = {name: uuid.UUID(row["id"]) for name, row in TEAM_ROWS.items()}
USERS = {name: uuid.UUID(row["id"]) for name, row in USER_ROWS.items()}
MODELS = {name: uuid.UUID(row["id"]) for name, row in MODEL_ROWS.items()}
SUBMISSIONS = {name: uuid.UUID(row["id"]) for name, row in SUBMISSION_ROWS.items()}


def _task_submissions() -> dict[str, dict[str, uuid.UUID]]:
    """Task submission ids, nested submission label → task id.

    A task submission has no name of its own — it *is* a submission and a task — so it
    takes both: ``TASK_SUBMISSIONS["mlp-ts1-baseline"]["ts1-reward"]``.
    """
    labels = {row["id"]: row["label"] for row in _ROWS["submissions"]}
    nested: dict[str, dict[str, uuid.UUID]] = {}

    for row in _ROWS["task_submissions"]:
        nested.setdefault(labels[row["submission_id"]], {})[row["task_id"]] = uuid.UUID(row["id"])

    return nested


TASK_SUBMISSIONS = _task_submissions()


@pytest_asyncio.fixture
async def caller(client):
    """The signed-in user's own record, whoever the auth backend resolves them to.

    Asking for /me is also what upserts the dev-mode stub user, so this is the first
    thing most tests do.

    Read the caller's email from here rather than restating it: the stub's address is a
    literal inside ``app.auth``'s dev-mode branch, and a test that repeats it is pinned
    to a detail two layers away. Fixture data is different — those rows are the test's
    own, so naming them in the test is right.
    """
    response = await client.get("/api/users/me")

    return response.json()


@pytest_asyncio.fixture
async def me(caller):
    """The caller's user id."""
    return uuid.UUID(caller["id"])


@pytest_asyncio.fixture
async def add(session_factory):
    """Insert ORM rows and commit — ``await add(Team(...), UserTeam(...))``.

    Rows rather than a fixture file: what a test needs beyond the baseline is usually
    two or three objects, and building them in the test keeps the setup next to the
    assertion it exists for.
    """

    async def _add(*rows):
        async with session_factory() as session:
            session.add_all(rows)
            await session.commit()

    return _add
