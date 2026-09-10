"""Submission endpoints: creating one, uploading its file, and reading it back."""

import logging
import math
import uuid
from collections import Counter
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import ColumnElement, and_, func, or_, select, true
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import (
    get_current_user,
    get_current_user_optional,
    is_team_member,
    member_team_ids,
    require_team_member,
)
from app.config import settings
from app.database import get_session
from app.models import (
    Model,
    Submission,
    SubmissionStatus,
    SubmissionUser,
    SubmissionUserRole,
    Task,
    TaskScore,
    TaskSubmission,
    TaskSuite,
    User,
    UserRole,
)
from app.schemas.submissions import (
    MAX_PARTS,
    PartUrl,
    PrevalidateRequest,
    PrevalidateResponse,
    SubmissionCreate,
    SubmissionDetail,
    SubmissionResponse,
    SubmissionSubmit,
    SubmissionUpdate,
    UploadCompleteRequest,
    UploadedPart,
    UploadResponse,
    ValidationCode,
    ValidationResponse,
)
from app.storage import (
    abort_multipart,
    complete_multipart,
    create_multipart,
    delete_submission_file,
    list_parts,
    presign_parts,
    submission_key,
    submission_size,
)
from app.tasks.score import score_submission
from app.tasks.validate import validate_submission
from app.validation.validate_submission import (
    Finding,
    crawl_submission_entries,
    is_generic_message,
    user_message,
)

router = APIRouter(prefix="/api/submissions", tags=["submissions"])

logger = logging.getLogger(__name__)

# ── Per-submission aggregates ──────────────────────────────────────────────────────


def submissions_of_teams(team_ids: Iterable[uuid.UUID]) -> ColumnElement[bool]:
    """Return an expression that is True for submissions belonging to ``team_ids``.

    Through the model, because that is the only place a submission's team is recorded —
    the row itself names a model, and the model names the team. One helper rather than the
    subquery written out at each call site, so "whose submission is this" is answered the
    same way everywhere.
    """
    return Submission.model_id.in_(select(Model.id).where(Model.team_id.in_(list(team_ids))))


# A file still arriving, or one that was rejected, is the team's own business: it has nothing
# to show, and it may never exist.
IN_FLIGHT = (
    SubmissionStatus.uploading,
    SubmissionStatus.validating,
    SubmissionStatus.invalid,
    SubmissionStatus.unchecked,
)


# What the create form's Remove button may delete: everything before a submission becomes a
# result. The default guard on ``DELETE``, which ``force`` drops.
ABANDONABLE = (
    SubmissionStatus.uploading,
    SubmissionStatus.invalid,
    SubmissionStatus.unchecked,
    SubmissionStatus.pending,
)


def arrived() -> ColumnElement[bool]:
    """Return an expression that is True for submissions whose file arrived and passed."""
    return Submission.status.notin_(IN_FLIGHT)


def has_arrived(submission: Submission) -> bool:
    """Whether ``submission``'s file arrived and passed validation.

    The loaded-instance form of :func:`arrived`, for the call sites that hold submissions
    rather than build queries.
    """
    return submission.status not in IN_FLIGHT


async def visible_submissions(
    user: User | None,
    session: AsyncSession,
) -> ColumnElement[bool]:
    """Return a SQLAlchemy expression that evaluates to True for submissions visible to the user.

    Publishing a submission does not publish it before it exists: an in-flight one stays with
    its team, which still sees it — a submitter who reloads mid-form reaches it through the
    listing, and there is nowhere else to reach it from.

    An admin sees every submission.
    """

    published_submission = and_(Submission.is_public.is_(True), arrived())

    if user is None:
        return published_submission

    # A tautology rather than every team id: an admin's listing costs no more than an
    # anonymous one.
    if user.role is UserRole.admin:
        return true()

    my_team_ids = await member_team_ids(user.id, session)

    return or_(published_submission, submissions_of_teams(my_team_ids))


async def suites_per_submission(
    submission_ids: Sequence[uuid.UUID],
    session: AsyncSession,
) -> dict[uuid.UUID, list[TaskSuite]]:
    """Return the task suites per submission in ``submission_ids``.

    Returns a dict of {submissionId: [TaskSuite]}.
    """
    if not submission_ids:
        return {}

    rows = await session.execute(
        select(TaskSubmission.submission_id, Task.task_suite)
        .join(Task, Task.id == TaskSubmission.task_id)
        .join(TaskScore, TaskScore.task_submission_id == TaskSubmission.id)
        .where(TaskSubmission.submission_id.in_(list(submission_ids)))
        .distinct()
    )

    suites: dict[uuid.UUID, list[TaskSuite]] = {}
    for submission_id, suite in rows.all():
        suites.setdefault(submission_id, []).append(suite)

    return suites


# ── Helper functions ──────────────────────────────────────────────────────
async def _get_submission(
    submission_id: uuid.UUID,
    session: AsyncSession,
    options: Sequence[Any] = (),
) -> Submission:
    """Fetch a submission by ``submission_id``, applying any loader ``options``.

    Raises: 404 - Not found if the submission doesn't exist
    """

    submission = (
        await session.execute(
            select(Submission)
            .options(
                selectinload(Submission.user_links),
                selectinload(Submission.model).selectinload(Model.team),
                *options,
            )
            .where(Submission.id == submission_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()

    if submission is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Submission not found")

    return submission


async def _get_submission_as_member(
    submission_id: uuid.UUID,
    user_id: uuid.UUID,
    session: AsyncSession,
    *,
    options: Sequence[Any] = (),
) -> Submission:
    """Fetch a submission by ``submission_id``, enforcing that ``user_id`` is part of the submission's team.

    Raises: 404 - Not found if the submission doesn't exist
    Raises: 403 - Forbidden if the user is not a member of the submission's team
    """

    submission = await _get_submission(submission_id, session, options=options)
    await require_team_member(user_id, submission.model.team_id, session)

    return submission


async def _get_submission_as_user(
    submission_id: uuid.UUID,
    user_id: uuid.UUID,
    session: AsyncSession,
    *,
    options: Sequence[Any] = (),
) -> Submission:
    """Fetch a submission by ``submission_id``, enforcing that ``user_id`` is owner or collaborator.

    Raises: 404 - Not found if the submission doesn't exist
    Raises: 403 - Forbidden if the user is not linked to the submission
    """

    submission = await _get_submission(submission_id, session, options=options)
    if not any(link.user_id == user_id for link in submission.user_links):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not authorised for this submission")
    return submission


async def _get_submission_as_viewer(
    submission_id: uuid.UUID,
    user_id: uuid.UUID | None,
    session: AsyncSession,
    *,
    options: Sequence[Any] = (),
) -> Submission:
    """Fetch a submission by ``submission_id``, enforcing only that the caller may *read* it.

    Public submissions are readable by anyone, signed in or not; a private one only by
    its team, and so is one whose file has not yet arrived and passed. The read counterpart of ``_get_submission_as_member``, which stays the rule
    for changing anything — publishing a submission opens it to being seen, not edited.

    The same rule ``visible_submissions`` applies to the listings, for one submission
    rather than as a WHERE clause.

    Raises: 404 - Not found if the submission doesn't exist
    Raises: 403 - Forbidden if it is private and the caller is not a member of its team
    """

    submission = await _get_submission(submission_id, session, options=options)

    if not submission.is_public or not has_arrived(submission):
        await require_team_member(user_id, submission.model.team_id, session)

    return submission


async def _get_team_from_model(
    model_id: uuid.UUID,
    session: AsyncSession,
) -> uuid.UUID:
    """Fetch the team ID associated with a model.

    Raises: 404 - Not found if the model doesn't exist
    """

    team_id = (
        await session.execute(select(Model.team_id).where(Model.id == model_id))
    ).scalar_one_or_none()

    if team_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Model not found")

    return team_id


async def _submission_with_label(
    label: str,
    model_id: uuid.UUID,
    session: AsyncSession,
    *,
    exclude_id: uuid.UUID | None = None,
) -> Submission | None:
    """The submission using ``label`` on ``model_id``, compared case-insensitively.

    Unique per model, not per team or globally: a label names a *run* of one model, so
    "seed-sweep" against two different models is two different things.

    ``exclude_id`` is the submission being updated, so keeping its own label is not a
    conflict with itself. Pass the *destination* model when a PATCH repoints it.
    """
    query = select(Submission).where(
        Submission.model_id == model_id, func.lower(Submission.label) == label.lower()
    )
    if exclude_id is not None:
        query = query.where(Submission.id != exclude_id)

    return (await session.execute(query)).scalar_one_or_none()


async def _check_valid_submission_label(
    label: str,
    model_id: uuid.UUID,
    session: AsyncSession,
    *,
    exclude_id: uuid.UUID | None = None,
) -> str:
    """Check a label is not blank and is unused on ``model_id``. Returns it trimmed.

    Raises: 422 - Unprocessable Content if the label is blank
    Raises: 409 - Conflict if the model already has a submission with that label
    """
    label = _check_label_not_blank(label)

    if await _submission_with_label(label, model_id, session, exclude_id=exclude_id) is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"This model already has a submission labelled '{label}'",
        )

    return label


def _check_label_not_blank(label: str) -> str:
    """Return ``label`` trimmed.

    Raises: 422 - Unprocessable Content if it is blank
    """
    label = label.strip()

    if not label:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Submission label cannot be blank"
        )

    return label


# ── Uploads ────────────────────────────────────────────────────────────────────────────────────


def _part_count(file_size: int) -> int:
    """Parts a file of ``file_size`` bytes needs at the configured part size."""
    return max(1, math.ceil(file_size / settings.upload_part_size))


def _local_ground_truth() -> Path:
    """The ground truth if it is on local disk, else a path that does not exist.

    ``_check_session_coverage`` skips a task whose ground-truth directory is absent, so a
    nonexistent path costs E104 and nothing else. Never downloads: this runs in a request.
    """
    return Path(settings.s3_gt_prefix)


def _validation_codes(findings: Sequence[Finding]) -> list[ValidationCode]:
    """Findings as a submitter may see them. ``detail`` is dropped, never relayed."""
    return [
        ValidationCode(
            code=finding.code,
            message=finding.message,
            path=finding.path,
            generic=is_generic_message(finding.code),
        )
        for finding in findings
    ]


def _require_uploading(submission: Submission) -> None:
    """Check a submission's file is still on its way.

    Raises: 409 - Conflict if it is not. The upload endpoints have nothing to act on once a
    file has arrived, and must not disturb one that is validating or scored.
    """
    if submission.status != SubmissionStatus.uploading or submission.upload_id is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "This submission is not awaiting an upload")


def _upload_response(
    submission: Submission,
    part_numbers: Iterable[int],
    uploaded: dict[int, str],
) -> UploadResponse:
    """Sign ``part_numbers`` and report them alongside what S3 already holds."""
    urls = presign_parts(submission.s3_key, submission.upload_id, part_numbers)

    return UploadResponse(
        submission_id=submission.id,
        s3_key=submission.s3_key,
        upload_id=submission.upload_id,
        part_size=settings.upload_part_size,
        part_count=_part_count(submission.file_size),
        part_urls=[PartUrl(part_number=number, url=url) for number, url in sorted(urls.items())],
        uploaded=[
            UploadedPart(part_number=number, etag=etag) for number, etag in sorted(uploaded.items())
        ],
    )


def _validation_response(submission: Submission) -> ValidationResponse:
    """A submission's validation state, with each stored code's safe message resolved."""
    document = submission.validation or {}

    return ValidationResponse(
        state=submission.status,
        n_files=document.get("n_files", 0),
        tasks=document.get("tasks", []),
        errors=[
            ValidationCode(
                code=code["code"],
                message=user_message(code["code"]),
                path=code["path"],
                generic=is_generic_message(code["code"]),
            )
            for code in document.get("codes", [])
        ],
        omitted=document.get("omitted", {}),
        finished_at=document.get("finished_at"),
    )


def _require_validated(submission: Submission) -> dict:
    """Return the validation document of a submission that is ready to be scored.

    Raises: 409 - Conflict if it is not ready, naming which of the four reasons applies.
    """
    if submission.status in (SubmissionStatus.uploading, SubmissionStatus.validating):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This submission's file has not finished validating"
        )

    if submission.status == SubmissionStatus.unchecked:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This submission's file could not be checked — contact us"
        )

    if submission.status != SubmissionStatus.pending:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This submission has already been submitted for scoring"
        )

    if not submission.validation:
        raise HTTPException(status.HTTP_409_CONFLICT, "This submission has not been validated")

    if submission.validation.get("codes"):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This submission's file did not pass validation"
        )

    return submission.validation


async def _apply_submission_update(
    submission: Submission,
    updates: dict,
    user_id: uuid.UUID,
    session: AsyncSession,
) -> None:
    """Apply the submission's own fields in ``updates`` to ``submission``, without committing.

    Shared by PATCH and submit, both of which carry these fields.

    Moving it to another model needs membership of that model's team as well; nothing else
    changes, since the team is the model's rather than the submission's own.

    Raises: 403 - Forbidden if the caller is not a member of the destination model's team
    Raises: 404 - Not found if the destination model doesn't exist
    Raises: 409 - Conflict if the label is taken on the destination model
    Raises: 422 - Unprocessable Content if the label is blank
    """
    # Reassignment is handled separately because it needs its own permission check on the
    # destination model's team — which is the submission's team the moment it moves.
    new_model_id = updates.pop("model_id", None)
    new_label = updates.pop("label", None)

    # Checked before anything is assigned: assigning first would let the unique index fire
    # during the autoflush that the label query triggers, turning a clean 409 into an
    # IntegrityError raised from inside a SELECT.
    model_id = new_model_id if new_model_id is not None else submission.model_id
    moved = new_model_id is not None and new_model_id != submission.model_id

    if moved:
        await require_team_member(
            user_id, await _get_team_from_model(new_model_id, session), session
        )

    # A move alone can collide, without any relabelling: the destination model may already
    # have a submission by this label. So the check runs whenever either half changes.
    label = None
    if new_model_id is not None or new_label is not None:
        label = await _check_valid_submission_label(
            new_label if new_label is not None else submission.label,
            model_id,
            session,
            exclude_id=submission.id,
        )

    if moved:
        submission.model_id = new_model_id
    if label is not None:
        submission.label = label

    for field, value in updates.items():
        setattr(submission, field, value)


async def _restart_upload(
    submission: Submission,
    body: SubmissionCreate,
    session: AsyncSession,
) -> UploadResponse:
    """Pick up the caller's own unfinished attempt at this label.

    An ``uploading`` row whose file is the same size keeps its multipart upload, so parts
    that already arrived are not sent twice and only the missing ones are signed. Anything
    else starts a new upload: an ``invalid`` or ``unchecked`` row has no multipart upload to
    keep, ``complete`` having cleared its id, and a fresh one overwrites the same key.

    The body's fields overwrite the row's: the submitter is filling the form again, so what
    they have just typed wins. ``validation`` is cleared, or the previous run's codes would
    be reported for the whole of the new upload.
    """
    resuming = (
        submission.status == SubmissionStatus.uploading
        and submission.upload_id is not None
        and submission.file_size == body.file_size
    )

    if not resuming:
        if submission.upload_id is not None:
            abort_multipart(submission.s3_key, submission.upload_id)
        submission.upload_id = create_multipart(submission.s3_key)

    submission.status = SubmissionStatus.uploading
    submission.validation = None
    submission.file_size = body.file_size
    submission.is_public = body.is_public
    submission.is_deterministic = body.is_deterministic
    submission.narrative_public = body.narrative_public
    submission.narrative_private = body.narrative_private

    await session.commit()

    uploaded = list_parts(submission.s3_key, submission.upload_id) if resuming else {}
    missing = [
        number for number in range(1, _part_count(body.file_size) + 1) if number not in uploaded
    ]

    return _upload_response(submission, missing, uploaded)


async def _validate_task_ids(task_ids: list[str], session: AsyncSession) -> None:
    """Check that all task IDS are valid and that there are no duplicates.

    Raises: 400 - Bad request
    """
    known = set(
        (await session.execute(select(Task.id).where(Task.id.in_(list(task_ids))))).scalars().all()
    )
    unknown = sorted(set(task_ids) - known)
    if unknown:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown task IDs: {unknown}")

    # A task can only appear once
    duplicates = sorted(t for t, count in Counter(task_ids).items() if count > 1)
    if duplicates:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Duplicate task IDs: {duplicates}")


# ── Deletion ───────────────────────────────────────────────────────────────────────────────────


def _release_file(s3_key: str, upload_id: str | None) -> None:
    """Release whichever of the two a submission's file is held as.

    The stored parts of an unfinished upload, or the assembled object. Never both:
    ``complete`` clears the upload id as it produces the object.

    Failures are logged, not raised: the rows are already gone by the time this runs.
    """
    try:
        if upload_id is not None:
            abort_multipart(s3_key, upload_id)
        else:
            delete_submission_file(s3_key)
    except Exception:
        logger.exception("could not release the file at %s", s3_key)


async def delete_and_release(
    record: Any, submissions: Sequence[Submission], session: AsyncSession
) -> None:
    """Delete ``record`` and release the files of the ``submissions`` going with it.

    ``record`` is a submission, a model or a team. The ORM cascade takes everything under it,
    so every relationship it reaches must already be loaded: an async session cannot lazy-load
    during a flush.

    Files are released after the commit, so a failure there leaves an object behind rather
    than rows whose file has gone.

    Raises 409 if a worker wrote a score under ``record`` between the read and the delete —
    a child row the cascade never loaded, which its foreign key then refuses.
    """
    # Read before the delete: a deleted instance cannot be refreshed for its own key.
    files = [(submission.s3_key, submission.upload_id) for submission in submissions]

    await session.delete(record)

    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "A submission was being scored — try again"
        ) from exc

    for s3_key, upload_id in files:
        _release_file(s3_key, upload_id)


async def _load_submission_detail(
    submission_id: uuid.UUID,
    user_id: uuid.UUID | None,
    session: AsyncSession,
) -> SubmissionDetail:
    """Return a submission's details, with its tasks and their scores.

    Raises: 404 - Not found if the submission doesn't exist
    Raises: 403 - Forbidden if it is private and the caller is not a member of its team
    """

    submission = await _get_submission_as_viewer(
        submission_id,
        user_id,
        session,
        options=[selectinload(Submission.task_submissions).selectinload(TaskSubmission.score)],
    )

    detail = SubmissionDetail.from_submission(submission)

    if await is_team_member(user_id, submission.model.team_id, session):
        return detail.model_copy(update={"is_mine": True})

    return detail.withhold_private()


# ── Endpoints ──────────────────────────────────────────────────────
@router.post("/prevalidate", response_model=PrevalidateResponse)
async def prevalidate(
    body: PrevalidateRequest,
    user: User = Depends(get_current_user),
) -> PrevalidateResponse:
    """Run the path-only checks over a client-supplied entry list, before any upload.

    Answers from the zip's central directory alone, so a badly structured submission is
    refused before its bytes are sent. Advisory: the list is client-supplied, and the
    authoritative run happens after the upload.

    Session coverage (E104) needs ground truth, and is skipped where it is not on local disk.

    Takes no submission — it runs before there is one — so membership has nothing to be
    checked against, and being signed in is the whole requirement.
    """
    crawl = crawl_submission_entries(body.entries, _local_ground_truth(), body.is_deterministic)

    for finding in crawl.findings:
        logger.info("prevalidate %s %s %s: %s", user.id, finding.code, finding.path, finding.detail)

    return PrevalidateResponse(
        ok=bool(crawl.seed_entries) and not crawl.findings,
        n_files=len(crawl.seed_entries),
        tasks=sorted({task for task, _ in crawl.coverage}),
        errors=_validation_codes(crawl.findings),
    )


@router.post("", response_model=UploadResponse)
async def create_submission(
    body: SubmissionCreate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> UploadResponse:
    """Create a submission and start the multipart upload of its file.

    A label already held by the caller's own unfinished attempt restarts that attempt rather
    than colliding — see ``_restart_upload``. Only a submission whose file has already
    arrived collides.

    ``file_size`` is what the client declares, so the limit it is checked against is a
    courtesy; the assembled object is measured again at completion.

    Raises: 403 - Forbidden if the caller is not a member of the model's team
    Raises: 404 - Not found if the model doesn't exist
    Raises: 409 - Conflict if the label belongs to a submission whose file has arrived
    Raises: 422 - Unprocessable Content if the label is blank or the file is too large
    """

    # Permission lives on the model's team, which is also the submission's — it just
    # isn't written down twice.
    await require_team_member(user.id, await _get_team_from_model(body.model_id, session), session)

    label = _check_label_not_blank(body.label)

    if body.file_size > settings.max_submission_bytes:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"A submission may be at most {settings.max_submission_bytes} bytes",
        )

    if _part_count(body.file_size) > MAX_PARTS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"File is too large to upload in {MAX_PARTS} parts",
        )

    existing = await _submission_with_label(label, body.model_id, session)

    if existing is not None:
        if existing.status not in (
            SubmissionStatus.uploading,
            SubmissionStatus.invalid,
            SubmissionStatus.unchecked,
        ):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"This model already has a submission labelled '{label}'",
            )
        return await _restart_upload(existing, body, session)

    # Pre-assign id so the S3 key is stable before the first flush.
    submission_id = uuid.uuid4()
    s3_key = submission_key(submission_id, label)

    submission = Submission(
        id=submission_id,
        model_id=body.model_id,
        label=label,
        s3_key=s3_key,
        status=SubmissionStatus.uploading,
        file_size=body.file_size,
        upload_id=create_multipart(s3_key),
        is_public=body.is_public,
        is_deterministic=body.is_deterministic,
        narrative_public=body.narrative_public,
        narrative_private=body.narrative_private,
    )
    session.add(submission)

    submission_user = SubmissionUser(
        submission_id=submission_id, user_id=user.id, role=SubmissionUserRole.owner
    )
    session.add(submission_user)

    await session.commit()

    return _upload_response(submission, range(1, _part_count(body.file_size) + 1), {})


@router.get("/{submission_id}/upload", response_model=UploadResponse)
async def get_upload(
    submission_id: uuid.UUID,
    response: Response,
    parts: list[int] = Query(default=[]),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> UploadResponse:
    """What S3 already holds, and a fresh signature for each part in ``parts``.

    The recovery path, for a client whose signatures expired or which lost them to a reload.
    Sent ``no-store``: the body carries credentials.

    Raises: 404 - Not found if the submission doesn't exist
    Raises: 403 - Forbidden if the caller is not a member of the submission's team
    Raises: 409 - Conflict if its file has already arrived
    """
    response.headers["Cache-Control"] = "no-store"

    submission = await _get_submission_as_member(submission_id, user.id, session)
    _require_uploading(submission)

    return _upload_response(submission, parts, list_parts(submission.s3_key, submission.upload_id))


@router.post("/{submission_id}/upload/complete", response_model=SubmissionResponse)
async def complete_upload(
    submission_id: uuid.UUID,
    body: UploadCompleteRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> SubmissionResponse:
    """Assemble the uploaded parts and queue validation.

    The object first exists at its key here, which is why this is what starts the worker —
    and why this is the first point the file's true size is knowable. An object over the
    limit is deleted and the submission left ``invalid``, since the declared size at create
    bounds nothing: S3 accepts up to 5 GB per part whatever the client claimed.

    Raises: 404 - Not found if the submission doesn't exist
    Raises: 403 - Forbidden if the caller is not a member of the submission's team
    Raises: 409 - Conflict if its file has already arrived
    Raises: 413 - Content Too Large if the assembled object exceeds the limit
    """
    submission = await _get_submission_as_member(submission_id, user.id, session)
    _require_uploading(submission)

    complete_multipart(
        submission.s3_key,
        submission.upload_id,
        [(part.part_number, part.etag) for part in body.parts],
    )
    submission.upload_id = None

    size = submission_size(submission.s3_key)

    if size is not None and size > settings.max_submission_bytes:
        submission.status = SubmissionStatus.invalid
        submission.file_size = size
        await session.commit()

        delete_submission_file(submission.s3_key)

        raise HTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE,
            f"A submission may be at most {settings.max_submission_bytes} bytes",
        )

    submission.status = SubmissionStatus.validating
    await session.commit()

    validate_submission.delay(str(submission.id))

    # Reread the submission: the commit's ``onupdate`` expires ``updated_at``, and building
    # the response would then have to fetch it from outside a greenlet.
    submission = await _get_submission_as_member(submission_id, user.id, session)

    return SubmissionResponse.from_submission(submission)


@router.delete("/{submission_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_submission(
    submission_id: uuid.UUID,
    force: bool = False,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    """Delete a submission, its task entries and their scores, and its file.

    ``force`` drops the status rule. Without it only a submission that has not been submitted
    for scoring may go, which is what the create form's Remove button sends: it holds the id
    of a file still arriving, and must not delete a result if it is ever wrong about which
    submission it has. The details page sends ``force``, having asked twice.

    Under ``force`` a submission being validated or scored goes like any other. The worker's
    next write finds the row gone and its task ends ``"gone"``.

    The loader options are the ORM cascade's, not the response's: an async session cannot
    lazy-load during a flush, and a scored submission is the first this reaches a score for.

    Raises 404 if the submission does not exist.
    Raises 403 if the caller is not a member of the submission's team.
    Raises 409 without ``force``, if it is being validated or submitted for scoring.
    Raises 409 if a worker wrote a score under it between the read and the delete.
    """
    submission = await _get_submission_as_member(
        submission_id,
        user.id,
        session,
        options=[selectinload(Submission.task_submissions).selectinload(TaskSubmission.score)],
    )

    if not force and submission.status not in ABANDONABLE:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This submission can no longer be deleted",
        )

    await delete_and_release(submission, [submission], session)


@router.get("/{submission_id}/validation", response_model=ValidationResponse)
async def get_validation(
    submission_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ValidationResponse:
    """The verdict on a submission's uploaded file, and the codes behind it.

    The submitter's own feedback rather than something a public submission publishes, so it
    is team-only. Polled while ``state`` is ``validating``.

    Raises: 404 - Not found if the submission doesn't exist
    Raises: 403 - Forbidden if the caller is not a member of the submission's team
    """
    submission = await _get_submission_as_member(submission_id, user.id, session)

    return _validation_response(submission)


@router.post("/{submission_id}/submit", response_model=SubmissionResponse)
async def submit(
    submission_id: uuid.UUID,
    body: SubmissionSubmit,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> SubmissionResponse:
    """Configure a validated submission's tasks and launch scoring.

    The declared tasks are checked against what validation found in the file: a task the
    archive does not contain has no predictions to score. A subset is allowed — the
    leaderboard is per task — and so is a set spanning suites, which
    :func:`app.tasks.score.score_submission` runs one scorer per.

    The submission's own fields arrive with it: they stay editable while the file uploads.

    Raises: 404 - Not found if the submission doesn't exist
    Raises: 403 - Forbidden if the caller is not a member of the submission's team
    Raises: 400 - Bad Request if a task is unknown, duplicated, or absent from the file
    Raises: 409 - Conflict if the submission is not validated and awaiting submission
    """
    submission = await _get_submission_as_member(submission_id, user.id, session)
    document = _require_validated(submission)

    task_ids = [task.task_id for task in body.tasks]
    await _validate_task_ids(task_ids, session)

    absent = sorted(set(task_ids) - set(document.get("tasks", [])))
    if absent:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"The uploaded file has no predictions for: {absent}",
        )

    updates = body.model_dump(exclude_unset=True)
    updates.pop("tasks")
    await _apply_submission_update(submission, updates, user.id, session)

    for task in body.tasks:
        session.add(TaskSubmission(submission_id=submission.id, **task.model_dump()))

    submission.status = SubmissionStatus.scoring
    await session.commit()

    # The scoring task moves it to done or failed once it finishes.
    score_submission.delay(str(submission.id))

    # Reread the submission: the commit's ``onupdate`` expires ``updated_at``, and building
    # the response would then have to fetch it from outside a greenlet.
    submission = await _get_submission_as_member(submission_id, user.id, session)

    return SubmissionResponse.from_submission(submission)


@router.get("", response_model=list[SubmissionResponse])
async def list_submissions(
    team_id: uuid.UUID | None = None,
    user: User | None = Depends(get_current_user_optional),
    session: AsyncSession = Depends(get_session),
) -> list[SubmissionResponse]:
    """List all submissions. Newest first.

    Adds the task suites to each submission.

    Anonymous callers see only public submissions.

    An authenticated user additionally sees every submission on a team they belong
    to, whether or not it is public. An admin sees all of them.

    ``team_id`` narrows the list to one team, for a team page listing what it has
    submitted. It narrows what is *shown*, never what is visible: a team the caller isn't
    in still yields only its public submissions.
    """

    visible = await visible_submissions(user, session)

    query = (
        select(Submission)
        .options(selectinload(Submission.model).selectinload(Model.team))
        .where(visible)
        .order_by(Submission.created_at.desc())
    )

    if team_id is not None:
        query = query.where(submissions_of_teams([team_id]))

    submissions = (await session.execute(query)).scalars().all()

    suites = await suites_per_submission([s.id for s in submissions], session)

    # One query for the whole listing rather than a membership check per row.
    my_team_ids = await member_team_ids(user.id if user else None, session)

    # An admin may edit every row, which is what ``is_mine`` reports.
    admin = user is not None and user.role is UserRole.admin

    return [
        SubmissionResponse.from_submission(
            submission,
            task_suites=suites.get(submission.id, []),
            is_mine=admin or submission.model.team_id in my_team_ids,
        )
        for submission in submissions
    ]


@router.get("/{submission_id}", response_model=SubmissionDetail)
async def get_submission(
    submission_id: uuid.UUID,
    user: User | None = Depends(get_current_user_optional),
    session: AsyncSession = Depends(get_session),
) -> SubmissionDetail:
    """Get a submission by ``submission_id``.

    A public submission is readable by anyone. A private one can only be read by a team member.

    A reader outside the team gets the submission without its team-only fields; see
    ``SubmissionDetail.withhold_private``.

    Raises: 404 - Not found if the submission doesn't exist
    Raises: 403 - Forbidden if it is private and the caller is not a member of its team
    """

    return await _load_submission_detail(submission_id, user.id if user else None, session)


@router.patch("/{submission_id}", response_model=SubmissionDetail)
async def update_submission(
    submission_id: uuid.UUID,
    body: SubmissionUpdate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> SubmissionDetail:
    """Update a submission by ``submission_id``.

    Only members of the submission's team can update it.

    The only fields that can be updated are specified by SubmissionUpdate. If any other
    fields are given it raises with a 422 response.

    Moving it to another model needs membership of that model's team as well; nothing
    else changes, since the team is the model's rather than the submission's own.

    Raises: 404 - Not found if the submission doesn't exist
    Raises: 403 - Forbidden if the user is not a member of the submission's team
    Raises: 422 - Unprocessable Entity if the request body contains fields that are not allowed to be updated
    """

    submission = await _get_submission_as_member(submission_id, user.id, session)

    await _apply_submission_update(
        submission, body.model_dump(exclude_unset=True), user.id, session
    )

    await session.commit()

    # A member by this point, so nothing is withheld.
    return await _load_submission_detail(submission_id, user.id, session)
