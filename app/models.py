"""SQLAlchemy ORM models."""

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    DateTime,
    Enum,
    ForeignKey,
    String,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class SubmissionStatus(str, enum.Enum):
    """Lifecycle of a submission."""

    pending = "pending"
    scoring = "scoring"
    done = "done"
    failed = "failed"


class Task(str, enum.Enum):
    """Benchmark task. Only ``ts1`` is currently scored."""

    ts1 = "ts1"


class Role(str, enum.Enum):
    """Role of a user on a submission."""

    owner = "owner"
    collaborator = "collaborator"


class User(Base):
    """A user authenticated through Auth0 (Google / Microsoft / ORCID)."""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    auth0_sub: Mapped[str] = mapped_column(String, unique=True, index=True)
    email: Mapped[str] = mapped_column(String)
    name: Mapped[str | None] = mapped_column(String, nullable=True)
    affiliation: Mapped[str | None] = mapped_column(String, nullable=True)
    provider: Mapped[str] = mapped_column(String)
    orcid_id: Mapped[str | None] = mapped_column(String, unique=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    links: Mapped[list["SubmissionUser"]] = relationship(back_populates="user")


class Submission(Base):
    """A benchmark submission: an uploaded zip of prediction files plus metadata."""

    __tablename__ = "submissions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(String, default="")
    affiliation: Mapped[str] = mapped_column(String, default="")
    email: Mapped[str] = mapped_column(String, default="")
    doi: Mapped[str | None] = mapped_column(String, nullable=True)
    task: Mapped[Task] = mapped_column(Enum(Task), default=Task.ts1)
    s3_key: Mapped[str] = mapped_column(String)
    status: Mapped[SubmissionStatus] = mapped_column(
        Enum(SubmissionStatus), default=SubmissionStatus.pending
    )
    score_results: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    is_public: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    links: Mapped[list["SubmissionUser"]] = relationship(
        back_populates="submission", cascade="all, delete-orphan"
    )


class SubmissionUser(Base):
    """Many-to-many association between submissions and users, carrying a role."""

    __tablename__ = "submission_users"

    submission_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("submissions.id"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), primary_key=True)
    role: Mapped[Role] = mapped_column(Enum(Role), default=Role.owner)

    submission: Mapped["Submission"] = relationship(back_populates="links")
    user: Mapped["User"] = relationship(back_populates="links")
