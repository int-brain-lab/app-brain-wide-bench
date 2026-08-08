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


class ModelResponse(ModelMetadata):
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

        Resolving ``team_name`` once here is why the subclasses need no ``from_model``
        of their own — their extra fields come through ``extra`` and land on ``cls``.
        Whatever the caller passes there (``n_submissions``, ``task_suites``,
        ``submissions``) must already be visibility-scoped: the public directory must
        not count private submissions.

        Validates against ``ModelResponse`` rather than ``cls`` on purpose. With
        ``cls``, ModelDetail would read and coerce ``Model.submissions`` off the
        relationship — the *unscoped* list — only for ``extra`` to replace it.

        ``exclude={"team_name"}`` because it would otherwise be passed twice: once as
        the ``None`` from validation, once resolved.
        """
        return cls(
            **ModelResponse.model_validate(model).model_dump(exclude={"team_name"}),
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



class ModelList(ModelResponse):
    """List item for GET /api/models and GET /api/users/me/models.

    Both fields are aggregates over the model's submissions rather than columns, so
    they can't come from ``model_validate`` — the caller computes them (``model_stats``
    in app/routers/models.py) and passes them to ``from_model``.

    They default to "nothing known" so a bare ``from_model(model)`` still works. That
    does mean a caller who forgets them reports 0 submissions rather than failing
    loudly, which is what the tests on both list endpoints are for.
    """

    n_submissions: int = 0
    task_suites: list[TaskSuite] = Field(default_factory=list)


class ModelDetail(ModelResponse):
    """Detailed model information for GET /api/models/{id}.

    Deliberately a sibling of ModelList rather than a subclass: ModelList's
    ``n_submissions`` and ``task_suites`` are summaries *of* ``submissions``, which
    this response already carries in full and already visibility-scoped. A client can
    derive both from it, so shipping them too would mean two numbers that can
    disagree, plus a round of aggregate queries to produce them.

    ``submissions`` must already be visibility-scoped by the caller — see
    ``_load_model_detail``.
    """

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
