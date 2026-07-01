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
    pretrained_in_modalities: Modality | None = None
    pretrained_out_modalities: Modality | None = None
    pretraining_data: str | None = None
    created_at: datetime | None = None


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


class ModelDetail(ModelResponse):
    """Detail view for ``GET /api/models/{id}`` — model card plus its submissions.

    ``submissions`` is visibility-scoped: only public ones for anonymous or
    non-team viewers, all of them for a member of the model's team.
    """

    team_name: str
    submissions: list[ModelSubmissionOut] = []
