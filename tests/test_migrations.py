"""Migration tests.

The first two need no database. ``alembic/env.py`` runs migrations synchronously using the
configured URL; the psycopg3 driver (``postgresql+psycopg://``) works for both the async
FastAPI engine and the sync Alembic engine, so no URL rewriting is needed. SQLAlchemy's sync
``create_engine`` imports the DBAPI eagerly (without connecting), so building the engine here
proves the migration driver is installed — the regression for the original
``ModuleNotFoundError`` that broke ``alembic upgrade head``.

The last one needs a real Postgres and is skipped without one. It is the guard the initial
migration's own docstring asks for: a database built *only* from the migrations, compared
against ``SQLModel.metadata``. Nothing else catches a migration that has drifted from the
ORM, because the fixture loader and the test suite both build their schema from the metadata
rather than by migrating — which is exactly how four columns were once declared one type in
the migrations and another in the models, invisibly. It cannot run on SQLite: the schema is
Postgres-specific by design, JSONB among it.
"""

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, text
from sqlmodel import SQLModel

from app import models  # noqa: F401  — registers every table on the metadata
from app.config import settings


def _postgres_available() -> bool:
    """Whether the configured database can be connected to at all."""
    if "postgresql" not in settings.database_url:
        return False

    try:
        with create_engine(settings.database_url).connect() as connection:
            connection.execute(text("select 1"))
    except Exception:
        return False

    return True


requires_postgres = pytest.mark.skipif(
    not _postgres_available(),
    reason=f"no Postgres to migrate: {settings.database_url}",
)


def test_migration_sync_driver_importable():
    """The migration driver must be installed (catches a missing psycopg)."""
    engine = create_engine(settings.database_url)  # imports the DBAPI, no connection
    assert engine.dialect.dbapi is not None


def test_database_url_uses_dual_mode_driver():
    """A single psycopg3 driver must serve both the async app and sync migrations."""
    assert "+psycopg" in settings.database_url or settings.database_url.startswith("sqlite")


@requires_postgres
def test_migrations_match_the_models():
    """A database built only from the migrations must be what the ORM describes.

    Run against a throwaway schema so the developer's own database is left alone. Any
    difference is reported rather than merely counted: the whole value here is being told
    *which* column has drifted.
    """
    engine = create_engine(settings.database_url)
    schema = "migration_check"

    with engine.begin() as connection:
        connection.execute(text(f'drop schema if exists "{schema}" cascade'))
        connection.execute(text(f'create schema "{schema}"'))

    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", settings.database_url)
    config.set_main_option("version_table_schema", schema)

    try:
        with engine.begin() as connection:
            connection.execute(text(f'set search_path to "{schema}"'))

            config.attributes["connection"] = connection
            command.upgrade(config, "head")

            context = MigrationContext.configure(
                connection,
                opts={"include_schemas": False, "target_metadata": SQLModel.metadata},
            )

            differences = compare_metadata(context, SQLModel.metadata)

        assert differences == [], f"migrations have drifted from the models: {differences}"
    finally:
        with engine.begin() as connection:
            connection.execute(text(f'drop schema if exists "{schema}" cascade'))
