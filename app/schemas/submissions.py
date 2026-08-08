"""Submission request/response schemas."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models import TaskSuite
from app.schemas.tasksubmission import TaskSubmissionCreate, TaskSubmissionDetail


class PresignResponse(BaseModel):
    """Response from ``POST /api/submissions/presign``."""

    submission_id: uuid.UUID
    upload_url: str
    s3_key: str


class SubmissionList(BaseModel):
    """Fields common to every API response."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    label: str
    status: str
    team_id: uuid.UUID
    model_id: uuid.UUID
    created_at: datetime
    updated_at: datetime | None = None
    is_public: bool
    team_name: str | None = None
    model_name: str | None = None

    # Which task suites this submission has a score for. An aggregate over its
    # task_submissions rather than a column, so it can't come from ``model_validate``
    # — the caller computes it (``suites_by_submission`` in app/routers/submissions.py)
    # and passes it in. Same arrangement as ``ModelList.task_suites``.
    #
    # Defaults to empty so a bare ``from_submission(submission)`` still works, which
    # is right for a just-presigned submission that has no scores yet.
    task_suites: list[TaskSuite] = []

    @classmethod
    def from_submission(cls, submission, task_suites=()) -> "SubmissionList":
        """Build from an ORM ``Submission`` with ``team`` and ``model`` loaded."""
        return cls.model_validate(submission).model_copy(
            update={
                "team_name": submission.team.name,
                "model_name": submission.model.name,
                "task_suites": list(task_suites),
            }
        )

# TODO SubmissionResponse shouldn't have the task suites in it. Need to refactor this
class SubmissionResponse(SubmissionList):
    """List item for GET /api/submissions."""

    s3_key: str
    narrative_public: str | None = None
    narrative_private: str | None = None


class SubmissionDetail(SubmissionResponse):
    """Detailed submission information for GET /api/submissions/{id}"""

    task_submissions: list[TaskSubmissionDetail] = []


class SubmissionCreate(BaseModel):
    """Request body for POST /api/submissions/presign."""

    model_config = ConfigDict(extra="forbid")

    team_id: uuid.UUID
    model_id: uuid.UUID
    label: str
    is_public: bool = False
    narrative_public: str | None = None
    narrative_private: str | None = None
    tasks: list[TaskSubmissionCreate]


class SubmissionUpdate(BaseModel):
    """Request body for PATCH /api/submissions/{id}."""

    model_config = ConfigDict(extra="forbid")

    label: str | None = None
    is_public: bool | None = None
    narrative_public: str | None = None
    narrative_private: str | None = None
