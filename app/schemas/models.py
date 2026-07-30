"""Model response schemas."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models import Modality
from app.schemas.submissions import TaskSubmissionOut


class ModelResponse(BaseModel):
    """List item for ``GET /api/users/me/models``."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    team_id: uuid.UUID
    name: str
    link_project: str | None = None
    link_weights: str | None = None
    link_code: str | None = None
    publication_doi: str | None = None
    n_parameters: int | None = None
    temporal_context_s: float
    is_pretrained: bool | None = None
    pretrained_in_modalities: list[Modality] | None = None
    pretrained_out_modalities: list[Modality] | None = None
    pretraining_data: str | None = None
    created_at: datetime | None = None


class ModelCreate(BaseModel):
    """Request body for ``POST /api/models``."""

    team_id: uuid.UUID
    name: str
    link_project: str | None = None
    link_weights: str | None = None
    link_code: str | None = None
    publication_doi: str | None = None
    n_parameters: int | None = None
    temporal_context_s: float = 1.0
    is_pretrained: bool | None = None
    pretrained_in_modalities: list[Modality] | None = None
    pretrained_out_modalities: list[Modality] | None = None
    pretraining_data: str | None = None


class ModelUpdate(BaseModel):
    """Request body for ``PATCH /api/models/{id}``. All fields optional; only set ones are applied."""

    name: str | None = None
    team_id: uuid.UUID | None = None
    link_project: str | None = None
    link_weights: str | None = None
    link_code: str | None = None
    publication_doi: str | None = None
    n_parameters: int | None = None
    temporal_context_s: float | None = None
    is_pretrained: bool | None = None
    pretrained_in_modalities: list[Modality] | None = None
    pretrained_out_modalities: list[Modality] | None = None
    pretraining_data: str | None = None


class ModelSubmissionOut(BaseModel):
    """Submission entry embedded in a model's card."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    label: str
    status: str
    is_public: bool
    created_at: datetime
    updated_at: datetime | None = None
    task_submissions: list[TaskSubmissionOut] = []


class ModelListItem(ModelResponse):
    """List item for ``GET /api/models`` and ``GET /api/users/me/models``.

    Deliberately not ``ModelDetail``: a listing shouldn't carry every model's full
    submission objects, only how many there are.

    ``n_submissions`` counts what the caller is entitled to see, so its meaning
    depends on the row: for a model the caller is a team member of it's every
    submission, and for one they can see only because it has public work it's the
    public ones. On ``/me/models`` every row is the caller's own, so it is always
    the full count.
    """

    team_name: str
    n_submissions: int = 0

    @classmethod
    def from_model(cls, model, n_submissions: int) -> "ModelListItem":
        """Build from an ORM ``Model`` whose ``team`` relationship is already loaded.

        The caller works out ``n_submissions``, because the rule differs per
        endpoint — see the note above.
        """
        return cls(
            **ModelResponse.model_validate(model).model_dump(),
            team_name=model.team.name,
            n_submissions=n_submissions,
        )


class ModelDetail(ModelResponse):
    """Detail view for ``GET /api/models/{id}`` — model card plus its submissions.

    ``submissions`` is visibility-scoped: only public ones for anonymous or
    non-team viewers, all of them for a member of the model's team.
    """

    team_name: str
    submissions: list[ModelSubmissionOut] = []
