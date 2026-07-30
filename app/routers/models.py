"""Model card endpoint: metadata plus visibility-scoped submissions."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import get_current_user, get_current_user_optional, is_team_member
from app.database import get_session
from app.models import Model, Submission, TaskSubmission, User, UserTeam
from app.schemas.models import (
    ModelCreate,
    ModelDetail,
    ModelListItem,
    ModelUpdate,
)

router = APIRouter(prefix="/api/models", tags=["models"])


async def _load_model_detail(model_id: uuid.UUID, user: User | None, session: AsyncSession) -> ModelDetail:
    """Build a model's card: metadata, team name, and visibility-scoped submissions.

    Anonymous viewers and non-team members see only public submissions; a
    member of the model's team sees all of them, public or private.
    """
    model = (
        await session.execute(
            select(Model)
            .options(
                selectinload(Model.team),
                selectinload(Model.submissions)
                .selectinload(Submission.task_submissions)
                .selectinload(TaskSubmission.score),
            )
            .where(Model.id == model_id)
        )
    ).scalar_one_or_none()
    if model is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Model not found")

    is_member = user is not None and await is_team_member(session, user.id, model.team_id)

    submissions = model.submissions if is_member else [s for s in model.submissions if s.is_public]

    return ModelDetail(
        id=model.id,
        team_id=model.team_id,
        name=model.name,
        link_project=model.link_project,
        link_weights=model.link_weights,
        link_code=model.link_code,
        publication_doi=model.publication_doi,
        n_parameters=model.n_parameters,
        temporal_context_s=model.temporal_context_s,
        is_pretrained=model.is_pretrained,
        pretrained_in_modalities=model.pretrained_in_modalities,
        pretrained_out_modalities=model.pretrained_out_modalities,
        pretraining_data=model.pretraining_data,
        created_at=model.created_at,
        team_name=model.team.name,
        submissions=submissions,
    )


async def _member_team_ids(session: AsyncSession, user: User | None) -> set[uuid.UUID]:
    """Team IDs ``user`` belongs to, fetched in one query.

    Used instead of calling ``is_team_member`` per model — that would be one
    round trip per row when scoping a whole listing.
    """
    if user is None:
        return set()

    result = await session.execute(
        select(UserTeam.team_id).where(UserTeam.user_id == user.id)
    )
    return set(result.scalars().all())


@router.get("", response_model=list[ModelListItem])
async def list_models(
    user: User | None = Depends(get_current_user_optional),
    session: AsyncSession = Depends(get_session),
) -> list[ModelListItem]:
    """List models with a public result, plus the caller's own models. Newest first.

    Anonymous callers see only models with at least one public submission — a
    model whose work is all private, or which has no submissions yet, is not
    listed at all. Listing it would publish its metadata (name, links, DOI,
    pretraining data) before its team has published anything.

    An authenticated caller additionally sees every model on a team they belong
    to, whether or not it has a public submission, so their own unpublished work
    is visible to them.

    ``n_submissions`` follows the same split: public-only for a model the caller
    isn't a member of, all submissions for their own.

    Compare ``GET /api/users/me/models``, which is *only* the caller's models and
    takes its scoping from the token rather than from this filter.
    """
    member_team_ids = await _member_team_ids(session, user)

    has_public_submission = (
        select(Submission.id)
        .where(Submission.model_id == Model.id, Submission.is_public.is_(True))
        .exists()
    )

    visible = has_public_submission
    if member_team_ids:
        visible = or_(has_public_submission, Model.team_id.in_(list(member_team_ids)))

    models = (
        await session.execute(
            select(Model)
            .options(selectinload(Model.team), selectinload(Model.submissions))
            .where(visible)
            .order_by(Model.created_at.desc())
        )
    ).scalars().all()

    # Submissions are loaded to be counted, which is fine at this scale (one
    # extra batched query, not N+1). If the directory grows enough for that to
    # matter, replace it with a grouped COUNT keyed by model_id.
    return [
        ModelListItem.from_model(
            model,
            n_submissions=sum(
                1
                for submission in model.submissions
                if submission.is_public or model.team_id in member_team_ids
            ),
        )
        for model in models
    ]


@router.post("", response_model=ModelDetail, status_code=status.HTTP_201_CREATED)
async def create_model(
    body: ModelCreate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ModelDetail:
    """Create a new model, owned by one of the requester's teams."""
    if not await is_team_member(session, user.id, body.team_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this team")

    model = Model(**body.model_dump())
    session.add(model)
    await session.commit()
    return await _load_model_detail(model.id, user, session)


@router.get("/{model_id}", response_model=ModelDetail)
async def get_model(
    model_id: uuid.UUID,
    user: User | None = Depends(get_current_user_optional),
    session: AsyncSession = Depends(get_session),
) -> ModelDetail:
    """Return a model's card: metadata, team name, and its submissions."""
    return await _load_model_detail(model_id, user, session)


@router.patch("/{model_id}", response_model=ModelDetail)
async def update_model(
    model_id: uuid.UUID,
    body: ModelUpdate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ModelDetail:
    """Update a model's metadata, or reassign it to a different team.

    Requires membership of the model's current team; reassignment additionally
    requires membership of the target team.
    """
    model = await session.get(Model, model_id)
    if model is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Model not found")
    if not await is_team_member(session, user.id, model.team_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this model's team")

    if body.team_id is not None and body.team_id != model.team_id:
        if not await is_team_member(session, user.id, body.team_id):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of the target team")
        model.team_id = body.team_id

    fields = [
        "name", "link_project", "link_weights", "link_code", "publication_doi",
        "n_parameters", "temporal_context_s", "is_pretrained",
        "pretrained_in_modalities", "pretrained_out_modalities", "pretraining_data",
    ]
    for field in fields:
        value = getattr(body, field)
        if value is not None:
            setattr(model, field, value)

    await session.commit()
    return await _load_model_detail(model_id, user, session)
