"""Alembic migration environment.

Reads the connection string from the ``DATABASE_URL`` env var and uses the ORM
``Base.metadata`` so ``--autogenerate`` can detect schema changes. The psycopg3
driver (``postgresql+psycopg://``) works for both async and sync engines, so the
same URL drives these synchronous migrations with no rewriting.
"""

import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

# Import models so that all tables are registered on SQLModel.metadata.
from sqlmodel import SQLModel
from app import models  # noqa: F401

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# psycopg3 drives both async and sync engines, so the URL needs no rewriting.
sync_url = os.environ.get("DATABASE_URL", "")
config.set_main_option("sqlalchemy.url", sync_url)

target_metadata = SQLModel.metadata


def run_migrations_offline() -> None:
    """Run migrations without a live DB connection (emits SQL)."""
    context.configure(
        url=sync_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations against a live DB connection."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
