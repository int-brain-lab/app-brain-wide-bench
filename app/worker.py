"""Celery application backed by Redis."""

from celery import Celery

from app.config import settings

celery_app = Celery(
    "brain_wide_bench",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["app.tasks.score"],
)
celery_app.conf.task_track_started = True
