"""Typed score-result schemas for TS1.

The pure scoring module returns a dict keyed by ``(label, task, recording_id)``.
``app.scoring.base.to_result`` flattens that into the JSON-serialisable shape modelled
here: a list of per-recording rows plus a per-task ``overall`` of every metric.

``r2``, ``poisson_d2`` and ``bps`` are floored at 0 per seed before aggregation. The
unclipped value is not kept anywhere.
"""

from pydantic import BaseModel


class ScoreResultBase(BaseModel):
    """Base class for a scorer's result.

    Lives here rather than in a shared module: nothing in the HTTP API uses it. A scorer
    returns one of these; the API only ever sees the ``TaskScore`` rows written from it.
    """


class MetricSummary(BaseModel):
    """Aggregated value of one metric across seeds.

    ``r2``, ``poisson_d2`` and ``bps`` are clipped at 0 per seed before aggregation; their
    ``mean`` and ``sem`` describe the clipped values.
    """

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
    """Full TS1 result: per-recording rows and each task's metrics over seeds."""

    rows: list[TS1RecordingScore] = []
    # every metric of each task, aggregated over seeds — keyed by flat task id
    overall: dict[str, dict[str, MetricSummary]] = {}
    error: str | None = None
