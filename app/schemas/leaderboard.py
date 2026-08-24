"""Leaderboard response schemas."""

import uuid
from datetime import datetime

from pydantic import BaseModel


class LeaderboardScore(BaseModel):
    """One task's result on a leaderboard row.

    ``mean``/``sem`` rather than ``primary_metric_mean``/``_sem``: which metric it is
    belongs to the task, and a row already says which task each score is under.
    """

    mean: float
    sem: float | None = None
    n_seeds: int

    @classmethod
    def from_score(cls, score) -> "LeaderboardScore":
        """Build from an ORM ``TaskScore``.

        Not ``model_validate``: the columns are ``primary_metric_mean``/``_sem`` and this
        shape drops the prefix, so the mapping has to be stated.
        """
        return cls(
            mean=score.primary_metric_mean,
            sem=score.primary_metric_sem,
            n_seeds=score.n_seeds,
        )


class LeaderboardRow(BaseModel):
    """A public, scored submission as the leaderboard shows it.

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
    created_at: datetime

    # Keyed by flat task id, e.g. {"ts1-reward": {...}}.
    scores: dict[str, LeaderboardScore] = {}

    # Average rank on each task, against the other rows in this response — see app/ranking.py.
    # One per task rather than one overall, because every figure the leaderboard shows is a
    # mean over these and only the client knows which tasks it is grouping.
    #
    # Empty for a submission superseded by a newer one from the same model and team: those
    # aren't ranked, since they aren't shown either.
    ranks: dict[str, float] = {}
