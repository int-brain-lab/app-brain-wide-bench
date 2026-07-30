"""User profile endpoints."""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import get_current_user
from app.database import get_session
from app.models import Model, Team, User, UserTeam
from app.schemas.models import ModelListItem
from app.schemas.teams import TeamResponse
from app.schemas.users import UserResponse, UserUpdate

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("/me", response_model=UserResponse)
async def me(user: User = Depends(get_current_user)) -> User:
    """Return the authenticated user's profile."""
    return user


@router.get("/me/models", response_model=list[ModelListItem])
async def my_models(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[ModelListItem]:
    """List models belonging to any team the current user is a member of.

    Only the caller's own models — contrast ``GET /api/models``, which is the
    directory: models with a public submission plus these.

    Because every row here is a model the caller is a member of, ``n_submissions``
    is the full count; there's no public/private split to apply.
    """
    result = await session.execute(
        select(Model)
        .options(selectinload(Model.team), selectinload(Model.submissions))
        .join(UserTeam, UserTeam.team_id == Model.team_id)
        .where(UserTeam.user_id == user.id)
        .order_by(Model.created_at.desc())
    )

    return [
        ModelListItem.from_model(model, n_submissions=len(model.submissions))
        for model in result.scalars().all()
    ]


@router.get("/me/teams", response_model=list[TeamResponse])
async def my_teams(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[Team]:
    """List teams the current user is a member of."""
    result = await session.execute(
        select(Team).join(UserTeam, UserTeam.team_id == Team.id).where(UserTeam.user_id == user.id)
    )
    return list(result.scalars().all())


@router.patch("/me", response_model=UserResponse)
async def update_me(
    body: UserUpdate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> User:
    """Update the authenticated user's name and/or affiliation."""
    if body.name is not None:
        user.name = body.name
    if body.affiliation is not None:
        user.affiliation = body.affiliation
    await session.commit()
    await session.refresh(user)
    return user
