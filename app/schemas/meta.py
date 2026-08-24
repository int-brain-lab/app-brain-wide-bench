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
