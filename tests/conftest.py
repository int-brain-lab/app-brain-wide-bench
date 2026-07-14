"""Shared fixtures for in-process API tests.

These run the FastAPI app against an in-memory async SQLite database with the S3
and Celery side-effects stubbed out — no containers, no Postgres, no Redis, no AWS.
"""

from pathlib import Path

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel

import app.models  # noqa: F401 — register tables on SQLModel.metadata
import app.routers.submissions as submissions_router
from app.database import get_session
from app.main import app
from tests.fixtures.load import load_fixture, seed_tasks

FIXTURE_PATH = Path(__file__).parent.joinpath("fixtures", "ts1_baseline.json")


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


@pytest_asyncio.fixture
async def seeded_client(client, session_factory):
    """HTTP client with the full ts1_baseline fixture pre-loaded."""
    async with session_factory() as s:
        await load_fixture(s, FIXTURE_PATH)
    return client
