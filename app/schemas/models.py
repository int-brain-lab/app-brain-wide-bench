"""Model response schemas."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models import Modality, TaskSuite
from app.schemas.tasksubmission import TaskSubmissionResponse


class ModelMetadata(BaseModel):
    """Optional metadata describing a model."""

    link_project: str | None = None
    link_weights: str | None = None
    link_code: str | None = None
    publication_doi: str | None = None
    n_parameters: int | None = None
    is_pretrained: bool | None = None
    pretrained_in_modalities: list[Modality] | None = None
    pretrained_out_modalities: list[Modality] | None = None
    pretraining_data: str | None = None


class ModelBase(ModelMetadata):
    """Fields common to every model API response."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    team_id: uuid.UUID
    name: str
    temporal_context_s: float
    created_at: datetime | None = None

    # Optional here only because it lives on the ``team`` relationship rather than on
    # the ORM object, so ``model_validate(model)`` can't populate it — ``from_model``
    # fills it in, so responses always carry it. Same arrangement as
    # ``SubmissionList.team_name``.
    team_name: str | None = None

    @classmethod
    def from_model(cls, model, **extra):
        """Build any model response from an ORM ``Model`` with ``team`` loaded.

        Validated against ``ModelBase`` and not ``cls``, which is deliberate and the
        opposite of ``SubmissionBase.from_submission``. Every field a subclass adds is
        something the caller computes — ``n_submissions``, ``task_suites``, and the
        visibility-filtered ``submissions`` — so none of them may be read off the ORM
        object. Validating against ``cls`` would let ``ModelDetail`` pick up the whole
        ``model.submissions`` relationship, private rows included, for any caller that
        forgot to pass the filtered list. Subclass fields arrive through ``extra``,
        which the constructor still validates.
        """
        return cls(
            **ModelBase.model_validate(model).model_dump(exclude={"team_name"}),
            team_name=model.team.name,
            **extra,
        )


class ModelSubmissionOut(BaseModel):
    """Submission embedded within a model detail response."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    label: str
    status: str
    is_public: bool
    created_at: datetime | None = None
    updated_at: datetime | None = None
    task_submissions: list[TaskSubmissionResponse] = Field(default_factory=list)


class ModelResponse(ModelBase):
    """List item for GET /api/models and GET /api/users/me/models."""

    n_submissions: int = 0
    task_suites: list[TaskSuite] = Field(default_factory=list)


class ModelDetail(ModelBase):
    """Detailed model information for GET /api/models/{id}."""

    submissions: list[ModelSubmissionOut] = Field(default_factory=list)


class ModelCreate(ModelMetadata):
    """Request body for POST /api/models."""

    model_config = ConfigDict(extra="forbid")

    team_id: uuid.UUID
    name: str
    temporal_context_s: float = 1.0


class ModelUpdate(ModelMetadata):
    """Request body for PATCH /api/models/{id}."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    team_id: uuid.UUID | None = None
    temporal_context_s: float | None = None
