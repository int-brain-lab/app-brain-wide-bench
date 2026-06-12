"""Typed score-result schemas for TS1.

The pure scoring module returns a dict keyed by ``(label, task, recording_id)``.
``TS1Scorer.score`` flattens that into the JSON-serialisable shape modelled here:
a list of per-recording rows plus a per-task ``summary`` of the primary metric used
to populate the public leaderboard.
"""

from app.schemas.base import ScoreResultBase
from pydantic import BaseModel


class MetricSummary(BaseModel):
    """Aggregated value of one metric across seeds."""

    mean: float
    sem: float | None = None
    n: int


class TS1RecordingScore(BaseModel):
    """Scores for a single (label, task, recording) triple."""

    label: str
    task: str
    recording_id: str
    metrics: dict[str, MetricSummary]


class TS1ScoreResult(ScoreResultBase):
    """Full TS1 result: per-recording rows and a per-task leaderboard summary."""

    rows: list[TS1RecordingScore] = []
    # primary metric of each task, averaged over recordings — keyed by flat task id
    summary: dict[str, MetricSummary] = {}
    error: str | None = None
