"""Submission request/response schemas."""

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.models import Modality, SubmissionStatus, TaskSuite
from app.schemas.tasksubmission import TaskSubmissionCreate, TaskSubmissionDetail

# S3's ceiling on parts in one multipart upload. A guard against an absurd
# ``upload_part_size``, not a size policy — that is ``settings.max_submission_bytes``.
MAX_PARTS = 10_000

# Caps on a prevalidate body. A real submission is a few thousand entries.
MAX_PREVALIDATE_ENTRIES = 50_000
MAX_ENTRY_LENGTH = 1024

Entry = Annotated[str, StringConstraints(max_length=MAX_ENTRY_LENGTH)]


class ValidationCode(BaseModel):
    """One finding, as a submitter may see it.

    ``Finding.detail`` has no field here and must never gain one: it can reveal
    ground-truth structure.
    """

    code: str
    message: str
    path: str


class PrevalidateRequest(BaseModel):
    """Request body for ``POST /api/submissions/prevalidate``."""

    model_config = ConfigDict(extra="forbid")

    entries: list[Entry] = Field(max_length=MAX_PREVALIDATE_ENTRIES)
    is_deterministic: bool = False


class PrevalidateResponse(BaseModel):
    """Verdict on an entry list. ``n_files`` tells an empty archive from a malformed one."""

    ok: bool
    n_files: int
    tasks: list[str]
    errors: list[ValidationCode]


class PartUrl(BaseModel):
    """A presigned ``PUT`` for one part. The part number is inside the signature."""

    part_number: int
    url: str


class UploadedPart(BaseModel):
    """A part S3 has stored, and the receipt that identifies it."""

    part_number: int = Field(ge=1, le=MAX_PARTS)
    etag: str


class UploadResponse(BaseModel):
    """An upload's state: what S3 holds, and a signature per part asked for.

    Answers both ``POST /api/submissions`` and ``GET /{id}/upload`` — a resumed create owes
    the client the same two halves a recovering one does.
    """

    submission_id: uuid.UUID
    s3_key: str
    upload_id: str
    part_size: int
    part_count: int
    part_urls: list[PartUrl] = []
    uploaded: list[UploadedPart] = []


class UploadCompleteRequest(BaseModel):
    """Request body for ``POST /{id}/upload/complete``."""

    model_config = ConfigDict(extra="forbid")

    parts: list[UploadedPart] = Field(min_length=1)


class SubmissionBase(BaseModel):
    """Fields common to every API response."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    label: str
    status: SubmissionStatus
    model_id: uuid.UUID
    created_at: datetime
    updated_at: datetime | None = None
    is_public: bool
    is_deterministic: bool

    # All three live on the ``model`` relationship rather than on the submission row —
    # a submission's team is its model's — so ``model_validate`` can't populate them and
    # ``from_submission`` fills them in. Optional here for that reason only; every
    # response carries them.
    team_id: uuid.UUID | None = None
    team_name: str | None = None
    model_name: str | None = None

    # Whether the caller is a member of the team that owns this submission, which is what
    # makes it theirs to edit — the same rule ``require_team_member`` enforces on PATCH. On
    # the base rather than on ``SubmissionDetail`` so a listing carries it too: a client
    # rendering a grid needs to mark its own rows without a request per row.
    #
    # A fact, never a decision: the endpoints check membership for themselves. Defaults
    # False, so a construction that says nothing about the caller claims nothing.
    is_mine: bool = False

    @classmethod
    def from_submission(cls, submission, **extra) -> "SubmissionBase":
        """Build from an ORM ``Submission`` with ``model`` and its ``team`` loaded.

        Validated against ``cls`` rather than ``SubmissionBase``, so a subclass picks up its
        own fields off the ORM object too — validating against the base drops ``s3_key`` and
        the rest, and ``SubmissionDetail`` then fails as a missing required field.

        ``extra`` is for what can't be read off the submission — ``task_suites`` is an
        aggregate its caller computes — and overrides anything of the same name.
        """
        return cls.model_validate(submission).model_copy(
            update={
                "team_id": submission.model.team_id,
                "team_name": submission.model.team.name,
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
    """Detailed submission information for GET /api/submissions/{id}.

    A public submission is readable by anyone, but two of these fields are the team's
    and stay that way — see ``withhold_private``.
    """

    # Nullable not because a submission can lack one, but because they are withheld from
    # a viewer outside the team.
    s3_key: str | None = None
    narrative_private: str | None = None
    narrative_public: str | None = None
    is_deterministic: bool = False
    task_submissions: list[TaskSubmissionDetail] = []

    # Populated by ``from_submission`` via ``model_validate``, which reads the eager-loaded
    # ``Submission.model`` relationship straight off the ORM object.
    model: SubmissionModelOut | None = None

    def withhold_private(self) -> "SubmissionDetail":
        """Return a copy with the team-only fields blanked, for a reader outside the team.

        "Public" describes the result, not the working notes. ``narrative_private`` is by
        its own name not for publication, and ``s3_key`` is an internal path a reader has
        no use for. Everything else — the scores, the methodology, the public narrative —
        is what publishing a submission is *for*.
        """
        return self.model_copy(update={"s3_key": None, "narrative_private": None})


class SubmissionCreate(BaseModel):
    """Request body for POST /api/submissions.

    No ``tasks``: panel 4 is filled in while the file uploads, so they arrive at ``submit``.
    """

    model_config = ConfigDict(extra="forbid")

    # N.B team-id is inferred from model-id
    model_id: uuid.UUID
    label: str
    file_size: int = Field(gt=0)
    is_public: bool = False
    is_deterministic: bool = False
    narrative_public: str | None = None
    narrative_private: str | None = None


class SubmissionUpdate(BaseModel):
    """Request body for PATCH /api/submissions/{id}.

    No ``is_deterministic``: it is set at create, and changed only by creating again under
    the same label while the file is still uploading. Once validation has reached a verdict
    under it, it is fixed — nothing verifies the claim, so moving it would silently change
    the rules that verdict was reached under.
    """

    model_config = ConfigDict(extra="forbid")

    # N.B team-id follows model-id, as it does on create
    model_id: uuid.UUID | None = None
    label: str | None = None
    is_public: bool | None = None
    narrative_public: str | None = None
    narrative_private: str | None = None


class SubmissionSubmit(SubmissionUpdate):
    """Request body for POST /api/submissions/{id}/submit.

    Panels 1-2 come along because they stayed editable while the file uploaded, so what the
    submitter has on screen is what should be stored.
    """

    tasks: list[TaskSubmissionCreate]


class ValidationResponse(BaseModel):
    """A submission's validation state, as its team may see it.

    ``state`` is the submission's own status rather than a second vocabulary: a client polls
    until it stops being ``validating``, and ``pending`` is the passing verdict.

    Messages are resolved from the stored codes on the way out, which is why they are not
    persisted — the wording can change without a migration, and there is no field here for
    ``Finding.detail`` to reach.
    """

    state: SubmissionStatus
    n_files: int = 0
    tasks: list[str] = []
    errors: list[ValidationCode] = []
    omitted: dict[str, int] = {}
    finished_at: str | None = None
