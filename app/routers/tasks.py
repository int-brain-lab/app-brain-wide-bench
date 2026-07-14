"""Task lookup endpoint."""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import Task
from app.schemas.tasks import TaskResponse

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


@router.get("/", response_model=list[TaskResponse])
async def list_tasks(session: AsyncSession = Depends(get_session)) -> list[Task]:
    """Return all known benchmark tasks, ordered by id."""
    result = await session.execute(select(Task).order_by(Task.id))
    return list(result.scalars().all())
