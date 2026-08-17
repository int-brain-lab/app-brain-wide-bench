"""Metadata endpoints: enum option lists for form dropdowns."""

from fastapi import APIRouter

from app.models import (
    Calibration,
    FinetuningStrategy,
    Modality,
    SupervisionRegime,
    TrainingParadigm,
)

router = APIRouter(prefix="/api/meta", tags=["meta"])


def _values(enum_cls) -> list[str]:
    return [member.value for member in enum_cls]


@router.get("/enums")
async def enums() -> dict[str, list[str]]:
    """Allowed values for each methodology dropdown, keyed by TaskSubmission field name."""
    return {
        "extra_input_modality": _values(Modality),
        "training_paradigm": _values(TrainingParadigm),
        "supervision_regime": _values(SupervisionRegime),
        "calibration": _values(Calibration),
        "finetuning_strategy": _values(FinetuningStrategy),
    }
