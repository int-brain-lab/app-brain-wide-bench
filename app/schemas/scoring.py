"""Typed score-result schemas for TS1.

The pure scoring module returns a dict keyed by ``(label, task, recording_id)``.
``TS1Scorer.score`` flattens that into the JSON-serialisable shape modelled here:
a list of per-recording rows plus a per-task ``summary`` of the primary metric used
to populate the public leaderboard.

Every mean here is aggregated by ``ibl_bwb_eval.scoring.aggregation.aggregate``, which floors
``r2`` and ``poisson_d2`` at 0 per seed first. The unclipped value is not kept anywhere.
"""

from pydantic import BaseModel


class ScoreResultBase(BaseModel):
    """Base class for a scorer's result.

    Lives here rather than in a shared module: nothing in the HTTP API uses it. A scorer
    returns one of these; the API only ever sees the ``TaskScore`` rows written from it.
    """


class MetricSummary(BaseModel):
    """Aggregated value of one metric across seeds.

    ``r2`` and ``poisson_d2`` are clipped at 0 per seed before aggregation, so their ``mean``
    and ``sem`` describe the clipped values.
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
    """Full TS1 result: per-recording rows and a per-task leaderboard summary."""

    rows: list[TS1RecordingScore] = []
    # primary metric of each task, averaged over recordings — keyed by flat task id
    summary: dict[str, MetricSummary] = {}
    error: str | None = None
