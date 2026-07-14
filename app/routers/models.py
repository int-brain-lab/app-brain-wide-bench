"""Model card endpoint: metadata plus visibility-scoped submissions."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import get_current_user_optional
from app.database import get_session
from app.models import Model, Submission, TaskSubmission, User, UserTeam
from app.schemas.models import ModelDetail

router = APIRouter(prefix="/api/models", tags=["models"])


@router.get("/{model_id}", response_model=ModelDetail)
async def get_model(
    model_id: uuid.UUID,
    user: User | None = Depends(get_current_user_optional),
    session: AsyncSession = Depends(get_session),
) -> ModelDetail:
    """Return a model's card: metadata, team name, and its submissions.

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

    is_team_member = user is not None and (
        await session.execute(
            select(UserTeam).where(UserTeam.user_id == user.id, UserTeam.team_id == model.team_id)
        )
    ).scalar_one_or_none() is not None

    submissions = model.submissions if is_team_member else [s for s in model.submissions if s.is_public]

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
