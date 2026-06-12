"""initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-06-12

Hand-authored initial migration creating users, submissions and the
submission_users association table. Regenerate with
``alembic revision --autogenerate`` once a live database is available.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_initial"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

submission_status = sa.Enum(
    "pending", "scoring", "done", "failed", name="submissionstatus"
)
task_enum = sa.Enum("ts1", name="task")
role_enum = sa.Enum("owner", "collaborator", name="role")


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("auth0_sub", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column("affiliation", sa.String(), nullable=True),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("orcid_id", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("auth0_sub"),
        sa.UniqueConstraint("orcid_id"),
    )
    op.create_index("ix_users_auth0_sub", "users", ["auth0_sub"])

    op.create_table(
        "submissions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=False),
        sa.Column("affiliation", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("doi", sa.String(), nullable=True),
        sa.Column("task", task_enum, nullable=False),
        sa.Column("s3_key", sa.String(), nullable=False),
        sa.Column("status", submission_status, nullable=False),
        sa.Column("score_results", sa.JSON(), nullable=True),
        sa.Column("is_public", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "submission_users",
        sa.Column("submission_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role", role_enum, nullable=False),
        sa.ForeignKeyConstraint(["submission_id"], ["submissions.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("submission_id", "user_id"),
    )


def downgrade() -> None:
    op.drop_table("submission_users")
    op.drop_table("submissions")
    op.drop_index("ix_users_auth0_sub", table_name="users")
    op.drop_table("users")
    submission_status.drop(op.get_bind(), checkfirst=True)
    task_enum.drop(op.get_bind(), checkfirst=True)
    role_enum.drop(op.get_bind(), checkfirst=True)
