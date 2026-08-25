"""Model response schemas."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models import Modality, SubmissionStatus, TaskSuite
from app.schemas.tasksubmission import TaskSubmissionOut


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

    # Whether the caller is a member of the team that owns this model, which is what makes
    # it theirs to edit — the same rule ``require_team_member`` enforces on PATCH. On the
    # base rather than on ``ModelDetail`` so a listing carries it too: a client rendering a
    # grid of models needs to mark its own without a request per row.
    #
    # A fact, never a decision: the endpoints check membership for themselves. Defaults
    # False, so a construction that says nothing about the caller claims nothing.
    is_mine: bool = False

    @classmethod
    def from_model(cls, model, **extra):
        """Build any model response from an ORM ``Model`` with ``team`` loaded.

        Validated against ``ModelBase`` and not ``cls``, which is deliberate and the
        opposite of ``SubmissionBase.from_submission``. Every field a subclass adds is
        something the caller computes — ``n_submissions``, ``task_suites``, ``is_mine``
        and the visibility-filtered ``submissions`` — so none of them may be read off the
        ORM object. Validating against ``cls`` would let ``ModelDetail`` pick up the whole
        ``model.submissions`` relationship, private rows included, for any caller that
        forgot to pass the filtered list. Subclass fields arrive through ``extra``,
        which the constructor still validates.
        """
        return cls(
            **ModelBase.model_validate(model).model_dump(exclude={"team_name", "is_mine"}),
            team_name=model.team.name,
            **extra,
        )


class ModelSubmissionOut(BaseModel):
    """Submission embedded within a model detail response."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    label: str
    status: SubmissionStatus
    is_public: bool
    created_at: datetime | None = None
    updated_at: datetime | None = None
    task_submissions: list[TaskSubmissionOut] = []


class ModelResponse(ModelBase):
    """List item for GET /api/models and GET /api/users/me/models."""

    n_submissions: int = 0
    task_suites: list[TaskSuite] = []


class ModelDetail(ModelBase):
    """Detailed model information for GET /api/models/{id}."""

    submissions: list[ModelSubmissionOut] = []


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


# ── Ranking ───────────────────────────────────────────────────────────────────


class RankPosition(BaseModel):
    """Where a model placed on one figure, and against how many.

    ``rank`` is the position, ``mean_rank`` the mean of the per-task ranks it was drawn
    from, and ``n_ranked`` the size of the field it was drawn against — "3rd of 12". The
    field is counted in models, which is what competes.
    """

    rank: int | None = None
    mean_rank: float | None = None
    n_ranked: int = 0


class OverallPosition(RankPosition):
    """The cross-suite figure, plus the coverage that decides whether it is awarded.

    ``rank`` is absent unless ``suites_scored`` reaches ``suites_total``: a model placed on
    the suites it happened to enter would beat one placed slightly lower across all of
    them. ``mean_rank`` is reported either way, so a partially covered model still learns
    where it stands.
    """

    suites_scored: int = 0
    suites_total: int = 0


class RankingSide(BaseModel):
    """One of the two rankings — as the model's public work stands, or as it would stand.

    ``suites`` carries only the suites the model was ranked in; one it never entered has
    no position rather than a last place.
    """

    overall: OverallPosition = OverallPosition()
    suites: dict[str, RankPosition] = {}

    @classmethod
    def from_placings(cls, placings) -> "RankingSide":
        """Build from a ``ranking.Placings``.

        Not ``model_validate``: the coverage counts sit beside the overall figure there
        and inside it here, because they only ever explain that one.
        """
        return cls(
            overall=OverallPosition(
                **vars(placings.overall),
                suites_scored=placings.suites_scored,
                suites_total=placings.suites_total,
            ),
            suites={
                suite: RankPosition(**vars(placing))
                for suite, placing in placings.suites.items()
            },
        )


class TaskEntryRef(BaseModel):
    """Which entry supplied a task's score — the task submission, and the submission it is in."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    submission_id: uuid.UUID


class TaskEntrySides(BaseModel):
    """The entry each ranking used for one task.

    Equal ids mean the same score served both. Different ones mean a newer private run
    supplied the private ranking while the public one fell back to an older public score.
    A null ``public`` is a task the model has only ever entered privately.
    """

    public: TaskEntryRef | None = None
    private: TaskEntryRef | None = None


class ModelRanking(BaseModel):
    """Where a model stands publicly, and where it would stand with its private work.

    Both rankings are computed against the same field — every other model's public
    standing — so the only thing that moves between them is this model's own entry, and
    the difference is what publishing would change.

    ``private`` is absent for a caller who is not on the model's team: it is a claim about
    work they cannot see.
    """

    model_id: uuid.UUID
    public: RankingSide = RankingSide()
    private: RankingSide | None = None

    # Keyed by flat task id, so a score table can look up the row it is drawing.
    tasks: dict[str, TaskEntrySides] = {}
