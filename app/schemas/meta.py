"""Schema for the one metadata document the frontend builds its forms from."""

from pydantic import BaseModel

from app.models import TaskSuite
from app.schemas.tasks import TaskResponse


class EnumOption(BaseModel):
    """One allowed value of an enum, with the help text shown beside it in a form."""

    value: str
    description: str


class SuiteInfo(BaseModel):
    """What a task suite asks a model to predict."""

    output_modality: str


class MetaResponse(BaseModel):
    """Everything the forms need that isn't anyone's data: the dropdown options and their
    help text, the per-field help text, the task table, and what each suite predicts.

    ``enums`` is keyed by *enum type* (``modality``, ``calibration``) and not by the field
    that uses it, so two fields backed by the same enum share one list — the model form's
    pretrained-modality pickers and the task form's extra-input picker are all ``modality``.
    The previous ``/api/meta/enums`` keyed by field name, which is why the model form ended
    up hardcoding its own modality list that had drifted from the enum.

    ``fields`` is keyed by record type, then by field name, mirroring each model's
    ``FIELD_DESCRIPTIONS``.
    """

    enums: dict[str, list[EnumOption]]
    fields: dict[str, dict[str, str]]
    tasks: list[TaskResponse]
    suites: dict[TaskSuite, SuiteInfo]


class MetaStats(BaseModel):
    """The two headline counts on the public landing page.

    Finished public work only, and no notion of a caller — the same footing as the
    leaderboard, so the figures describe what a signed-out visitor can go and read.
    """

    n_models: int
    n_submissions: int


class AuthConfig(BaseModel):
    """What the frontend needs to stand up an Auth0 session, read from the same ``.env``
    the backend already uses to verify tokens.

    None of these are secrets: ``domain`` and ``audience`` are visible in every login
    redirect and access token, and a SPA's ``client_id`` is a public identifier by
    Auth0's own design (a SPA authenticates via PKCE, not a ``client_secret``). Serving
    them here — rather than hardcoding them in the built JS — means a deploy points at
    its own Auth0 tenant by setting environment variables, with nothing to rebuild.

    ``dev_mode`` lets the frontend derive its own stub-auth behaviour from the backend's
    actual setting instead of a second, hand-maintained flag that could drift from it.
    """

    domain: str
    client_id: str
    audience: str
    dev_mode: bool
