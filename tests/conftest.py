"""Shared fixtures for in-process API tests.

These run the FastAPI app against an in-memory async SQLite database with the S3
and Celery side-effects stubbed out — no containers, no Postgres, no Redis, no AWS.
aiosqlite uses the same async greenlet machinery as psycopg3's async mode, so
async-ORM bugs (e.g. lazy-loads triggered outside the async context) reproduce here.
"""

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — register tables on Base.metadata
import app.routers.submissions as submissions_router
from app.database import Base, get_session
from app.main import app


@pytest_asyncio.fixture
async def engine():
    """In-memory async SQLite engine with the full schema created."""
    eng = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,  # one shared connection across sessions
    )
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    await eng.dispose()


@pytest_asyncio.fixture
async def session_factory(engine):
    """Session factory bound to the test engine (for direct DB setup in tests)."""
    return async_sessionmaker(engine, expire_on_commit=False)


@pytest_asyncio.fixture
async def client(engine, session_factory, monkeypatch):
    """HTTP client against the ASGI app with DB, S3 and Celery wired for tests."""

    async def override_get_session():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    # Stub S3 presign (no AWS) and Celery enqueue (no Redis broker).
    monkeypatch.setattr(
        submissions_router, "presign_put", lambda key, content_type="application/zip": f"https://s3.test/{key}"
    )
    monkeypatch.setattr(submissions_router.score_submission, "delay", lambda *a, **k: None)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c

    app.dependency_overrides.clear()
