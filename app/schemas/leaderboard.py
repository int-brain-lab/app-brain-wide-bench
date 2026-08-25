"""Leaderboard response schemas."""

import uuid
from datetime import datetime

from pydantic import BaseModel

from app.models import Metric


class LeaderboardScore(BaseModel):
    """One task's result on a leaderboard row.

    ``mean``/``sem`` rather than ``primary_metric_mean``/``_sem``: which metric it is
    belongs to the task, and a row already says which task each score is under. ``metric``
    is that metric spelled out, so a client showing one task's score can label its units
    without joining the task table to find them.

    The two ids are where the number came from. A row is a model's standing and its scores
    are each the newest for their task, so they need not share a submission — which is
    exactly why each one has to say which submission it is from.
    """

    mean: float
    sem: float | None = None
    n_seeds: int
    metric: Metric

    task_submission_id: uuid.UUID
    submission_id: uuid.UUID

    @classmethod
    def from_entry(cls, task_submission) -> "LeaderboardScore":
        """Build from an ORM ``TaskSubmission`` with a score.

        Not ``model_validate``: the columns are ``primary_metric_mean``/``_sem`` and this
        shape drops the prefix, so the mapping has to be stated.
        """
        score = task_submission.score

        return cls(
            mean=score.primary_metric_mean,
            sem=score.primary_metric_sem,
            n_seeds=score.n_seeds,
            metric=score.primary_metric,
            task_submission_id=task_submission.id,
            submission_id=task_submission.submission_id,
        )


class LeaderboardRow(BaseModel):
    """A model's standing as the leaderboard shows it.

    One row per model rather than per submission: what is ranked is a model's current
    result for each task, wherever it was submitted — see app/ranking.py. So the scores on
    a row may come from several submissions, and ``id``, ``label`` and ``created_at``
    describe the newest of them, which is what the row links to and dates itself by.

    Not ``SubmissionResponse``: this is the one view with no notion of a caller, so it
    carries no visibility-dependent fields, and its scores are flattened into a mapping
    the frontend turns into one column per task.
    """

    id: uuid.UUID
    label: str
    team_id: uuid.UUID
    team_name: str
    model_id: uuid.UUID
    model_name: str
    created_at: datetime | None = None

    # Whether the model is a pretrained foundation model, so a row can say so beside its
    # name. Nullable for the same reason the column is: a model whose pretraining fields
    # were never filled in makes no claim either way, and the client badges only ``True``.
    is_pretrained: bool | None = None

    # How many public, completed submissions stand behind the row, superseded ones included
    # — a row is a standing, so its own count is the only place that total survives.
    n_submissions: int = 0

    # Keyed by flat task id, e.g. {"ts1-reward": {...}}.
    scores: dict[str, LeaderboardScore] = {}

    # Average rank on each task, against the other rows in this response — see app/ranking.py.
    # One per task rather than one overall, because every figure the leaderboard shows is a
    # mean over these and only the client knows which tasks it is grouping.
    ranks: dict[str, float] = {}
