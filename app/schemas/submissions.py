"""Submission request/response schemas."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models import Modality, TaskSuite
from app.schemas.tasksubmission import TaskSubmissionCreate, TaskSubmissionDetail


class PresignResponse(BaseModel):
    """Response from ``POST /api/submissions/presign``."""

    submission_id: uuid.UUID
    upload_url: str
    s3_key: str


class SubmissionBase(BaseModel):
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

    @classmethod
    def from_submission(cls, submission, **extra) -> "SubmissionBase":
        """Build from an ORM ``Submission`` with ``team`` and ``model`` loaded.

        Validated against ``cls`` rather than ``SubmissionBase``, so a subclass picks up its
        own fields off the ORM object too — validating against the base drops ``s3_key`` and
        the rest, and ``SubmissionDetail`` then fails as a missing required field.

        ``extra`` is for what can't be read off the submission — ``task_suites`` is an
        aggregate its caller computes — and overrides anything of the same name.
        """
        return cls.model_validate(submission).model_copy(
            update={
                "team_name": submission.team.name,
                "model_name": submission.model.name,
                **extra,
            }
        )


class SubmissionResponse(SubmissionBase):
    """List item for GET /api/submissions and GET /api/users/me/submissions."""

    task_suites: list[TaskSuite] = []


class SubmissionModelOut(BaseModel):
    """The model a submission was made with, embedded in its detail response.

    Only the pretraining attributes, because those decide which methodology options are
    legal for a task submission — the client would otherwise have to fetch the whole model
    just to render the task editor. ``Submission.model`` is already eager-loaded on every
    submission fetch (``_get_submission_or_404``), so this costs no extra query.

    Not on ``SubmissionList``: list responses carry ``model_id`` and ``model_name``, which is
    all a table row needs, and there is no reason to repeat this per row.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    is_pretrained: bool | None = None
    pretrained_in_modalities: list[Modality] | None = None
    pretrained_out_modalities: list[Modality] | None = None


class SubmissionDetail(SubmissionBase):
    """Detailed submission information for GET /api/submissions/{id}"""

    s3_key: str
    narrative_public: str | None = None
    narrative_private: str | None = None
    task_submissions: list[TaskSubmissionDetail] = []

    # Populated by ``from_submission`` via ``model_validate``, which reads the eager-loaded
    # ``Submission.model`` relationship straight off the ORM object.
    model: SubmissionModelOut | None = None


class SubmissionCreate(BaseModel):
    """Request body for POST /api/submissions/presign."""

    model_config = ConfigDict(extra="forbid")

    # N.B team-id is inferred from model-id
    model_id: uuid.UUID
    label: str
    is_public: bool = False
    narrative_public: str | None = None
    narrative_private: str | None = None
    tasks: list[TaskSubmissionCreate]


class SubmissionUpdate(BaseModel):
    """Request body for PATCH /api/submissions/{id}."""

    model_config = ConfigDict(extra="forbid")

    # N.B team-id follows model-id, as it does on create
    model_id: uuid.UUID | None = None
    label: str | None = None
    is_public: bool | None = None
    narrative_public: str | None = None
    narrative_private: str | None = None
