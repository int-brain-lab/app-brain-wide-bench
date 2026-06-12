"""Migration-config tests that need no database connection or container.

``alembic/env.py`` runs migrations synchronously using the configured URL. The
psycopg3 driver (``postgresql+psycopg://``) works for both the async FastAPI engine
and the sync Alembic engine, so no URL rewriting is needed. SQLAlchemy's sync
``create_engine`` imports the DBAPI eagerly (without connecting), so building the
engine here proves the migration driver is installed — the regression for the
original ``ModuleNotFoundError`` that broke ``alembic upgrade head``.
"""

from sqlalchemy import create_engine

from app.config import settings


def test_migration_sync_driver_importable():
    """The migration driver must be installed (catches a missing psycopg)."""
    engine = create_engine(settings.database_url)  # imports the DBAPI, no connection
    assert engine.dialect.dbapi is not None


def test_database_url_uses_dual_mode_driver():
    """A single psycopg3 driver must serve both the async app and sync migrations."""
    assert "+psycopg" in settings.database_url or settings.database_url.startswith("sqlite")
