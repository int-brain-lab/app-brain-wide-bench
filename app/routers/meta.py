"""The one metadata document the frontend's forms are built from.

Dropdown options, the help text for every option and every field, the task table, and what
each suite predicts — everything a form needs that is not somebody's data. One endpoint
rather than several because the frontend is a multi-page app: every link is a full
navigation, so a page that had to assemble its schema from three fetches would pay for all
three again on the next page.

Served with an ``ETag``, and built once per process — see ``meta_document``.

``/api/meta/stats`` shares the prefix but not the document: two counts of finished public
work, which move with the data rather than with a deploy.
"""

import hashlib
import json

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    SUITE_OUTPUT_MODALITY,
    Calibration,
    DescribedEnum,
    FinetuningStrategy,
    Modality,
    Model,
    Submission,
    SubmissionStatus,
    SupervisionRegime,
    Task,
    TaskSubmission,
    TrainingParadigm,
)
from app.schemas.meta import EnumOption, MetaResponse, MetaStats, SuiteInfo
from app.schemas.tasks import TaskResponse

router = APIRouter(prefix="/api/meta", tags=["meta"])

# Keyed by enum type, not by the field that uses it — see MetaResponse.
ENUMS: dict[str, type[DescribedEnum]] = {
    "modality": Modality,
    "training_paradigm": TrainingParadigm,
    "supervision_regime": SupervisionRegime,
    "calibration": Calibration,
    "finetuning_strategy": FinetuningStrategy,
}

# The record types whose field help text the forms ask for. The keys are what the frontend
# schemas name themselves, and the values are where the wording actually lives.
DESCRIBED_RECORDS = {
    "model": Model,
    "submission": Submission,
    "task_submission": TaskSubmission,
}


def _options(described_enum: type[DescribedEnum]) -> list[EnumOption]:
    return [
        EnumOption(value=member.value, description=member.description)
        for member in described_enum
    ]


async def build_meta(session: AsyncSession) -> MetaResponse:
    tasks = (await session.execute(select(Task).order_by(Task.id))).scalars().all()

    return MetaResponse(
        enums={name: _options(enum_cls) for name, enum_cls in ENUMS.items()},
        fields={
            name: dict(model.FIELD_DESCRIPTIONS) for name, model in DESCRIBED_RECORDS.items()
        },
        tasks=[TaskResponse.model_validate(task) for task in tasks],
        suites={
            suite: SuiteInfo(output_modality=modality.value)
            for suite, modality in SUITE_OUTPUT_MODALITY.items()
        },
    )


# (body, etag). Module-level rather than per-request because nothing in the document can
# change while the process runs: the options and the help text are code, and ``Task`` is
# seeded in a migration and never written at runtime. A deploy restarts the container,
# which is what re-reads both — worth knowing if a migration ever reseeds ``tasks`` against
# a running app, because this would keep serving the old table until a restart.
#
# The point of caching the *body* and not just the payload is the ETag: computing it means
# serializing, so without this a 304 would still cost a query and a full serialization to
# work out that it could send nothing.
_document: tuple[str, str] | None = None


async def meta_document(session: AsyncSession) -> tuple[str, str]:
    global _document

    if _document is None:
        payload = await build_meta(session)
        # sort_keys so a change in dict insertion order can't move the ETag while the
        # content stays the same, which would force every client to re-download for nothing.
        body = json.dumps(payload.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
        _document = (body, f'"{hashlib.sha256(body.encode()).hexdigest()[:32]}"')

    return _document


def reset_meta_document() -> None:
    """Drop the cached document.

    Only the tests need this, and they need it because the cache is process-wide while
    each test gets its own database — without it the first test to hit the endpoint would
    fix the task table for every test after it.
    """
    global _document

    _document = None


@router.get("", responses={200: {"model": MetaResponse}})
async def meta(request: Request, session: AsyncSession = Depends(get_session)) -> Response:
    """Return the metadata document, or 304 if the caller already has this version.

    ``public`` because the document is byte-identical for every caller, signed in or not —
    which is also why there is no ``Vary: Authorization``, even though ``apiFetch`` sends a
    bearer token when there is one.

    ``max-age=300`` because the revalidation was a round trip on the critical path of every
    page: the frontend reads this document on all of them, and a 304 saves the body but not
    the wait. Five minutes is how long an edited description can still read as the old one.
    See docs/backend_caching_plan_todo.md.

    Returned as a raw ``Response`` rather than through ``response_model`` because the body
    has to be the exact bytes the ETag was computed over.
    """
    body, etag = await meta_document(session)
    headers = {"ETag": etag, "Cache-Control": "public, max-age=300"}

    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)

    return Response(content=body, media_type="application/json", headers=headers)


@router.get("/stats", response_model=MetaStats)
async def stats(
    response: Response,
    session: AsyncSession = Depends(get_session),
) -> MetaStats:
    """How much finished, public work the benchmark holds.

    Counted over public submissions in ``done`` and the distinct models behind them, which
    is the field the leaderboard ranks. It can read higher than the board's row count in one
    case: the board drops a model whose submissions carry no scored task, and this does not
    join scores to find out.

    Its own endpoint rather than a read of ``/api/leaderboard``, which the landing page used
    to sum: that one loads every public submission with all its task submissions and scores
    and ranks the lot, to produce two integers.

    No caller, so the answer is the same bytes for everyone — hence ``public`` and no
    ``Vary``. See docs/backend_caching_plan_todo.md.

    Not part of the meta document: that one is byte-identical for the life of the process,
    and these two move whenever a submission finishes.
    """
    finished_and_public = (
        Submission.is_public.is_(True),
        Submission.status == SubmissionStatus.done,
    )

    # One row rather than a count each: the two aggregates read the same filtered set.
    n_submissions, n_models = (
        await session.execute(
            select(func.count(), func.count(func.distinct(Submission.model_id)))
            .select_from(Submission)
            .where(*finished_and_public)
        )
    ).one()

    response.headers["Cache-Control"] = "public, max-age=300"

    return MetaStats(n_models=n_models, n_submissions=n_submissions)
