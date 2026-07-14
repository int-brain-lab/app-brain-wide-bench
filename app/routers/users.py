"""User profile endpoints."""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.database import get_session
from app.models import Model, User, UserTeam
from app.schemas.models import ModelResponse
from app.schemas.users import UserResponse, UserUpdate

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("/me", response_model=UserResponse)
async def me(user: User = Depends(get_current_user)) -> User:
    """Return the authenticated user's profile."""
    return user


@router.get("/me/models", response_model=list[ModelResponse])
async def my_models(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[Model]:
    """List models belonging to any team the current user is a member of."""
    result = await session.execute(
        select(Model).join(UserTeam, UserTeam.team_id == Model.team_id).where(UserTeam.user_id == user.id)
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
