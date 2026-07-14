"""Task response schemas."""

from pydantic import BaseModel, ConfigDict

from app.models import TaskSuite, TaskType


class TaskResponse(BaseModel):
    """List item for ``GET /api/tasks``."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    task_suite: TaskSuite
    task_type: TaskType
    primary_metric: str
