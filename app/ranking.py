"""Leaderboard ranking over the per-recording scores already in the database.

The benchmark's own ranking lives in ``core.scoring.aggregation.rank``: for each
``(task, recording_id)`` it orders models by that task's primary metric, promoting one past
the current anchor only when a one-sided Welch's t-test finds it significantly better, then
averages those per-recording ranks within each task. This module is the adapter — it
reshapes what we store into the shape that function takes, and nothing more. The statistics
are not reimplemented here, deliberately: a second copy would be a second thing to disagree
with the published numbers.

Ranks are computed over exactly the submissions handed in, so narrowing the leaderboard
narrows the field a model is ranked against rather than merely hiding rows.
"""

import logging
import warnings
from collections import defaultdict
from typing import Iterable, Mapping

from core.scoring.aggregation import NO_RECORDING_ID, rank as rank_labels

from app.models import Submission, Task

logger = logging.getLogger(__name__)

# The benchmark's own defaults. Named rather than passed inline so the two places that care
# — the ranking and anything reporting how it was produced — read the same constants.
ALPHA = 0.05
METHOD = "step_down"


def primary_metrics(tasks: Iterable[Task]) -> dict[str, str]:
    """``{task_id: metric name}`` — the metric each task is ranked on.

    The name, not the enum: it is matched against the keys of the ``metrics`` JSON, which
    were written by the scorer as plain strings.
    """
    return {task.id: task.primary_metric.value for task in tasks}


def latest_per_model_team(submissions: Iterable[Submission]) -> list[Submission]:
    """One submission per ``(model, team)`` — the newest.

    The same collapse the leaderboard table does before it draws a row, done here as well
    because the two have to agree: ranking every submission would have a model's older runs
    competing against its current one, and the ranks would then describe a field the reader
    is not being shown.

    Keyed on the pair rather than the model alone: a model can be reassigned to another team
    while its submissions keep the team they were made under.
    """
    latest: dict[tuple, Submission] = {}

    for submission in submissions:
        key = (submission.model_id, submission.team_id)
        held = latest.get(key)

        if held is None or submission.created_at > held.created_at:
            latest[key] = submission

    return list(latest.values())


def _summary(
    submissions: Iterable[Submission],
    metrics: Mapping[str, str],
) -> dict[tuple[str, str, str], dict[str, tuple[float, float | None, int]]]:
    """Build ``rank()``'s input from ``TaskScore.metrics["recordings"]``.

    Labelled by submission id. Not the ``label`` inside the JSON, which is free text the
    submitter chose and already collides across submissions in our own baselines; and not
    the model id, because a leaderboard row is a ``(model, team)`` pair and the submission
    is the thing that identifies one.

    TS3 has no recording dimension, so its rows carry no ``recording_id`` and take the
    sentinel ``aggregate()`` would have given them.
    """
    summary: dict[tuple[str, str, str], dict[str, tuple[float, float | None, int]]] = {}

    for submission in submissions:
        for task_submission in submission.task_submissions:
            score = task_submission.score
            metric = metrics.get(task_submission.task_id)

            if score is None or metric is None:
                continue

            for row in (score.metrics or {}).get("recordings", []):
                stats = (row.get("metrics") or {}).get(metric)

                if not stats or stats.get("mean") is None:
                    continue

                seeds = stats.get("n") or 1

                key = (
                    str(submission.id),
                    task_submission.task_id,
                    row.get("recording_id") or NO_RECORDING_ID,
                )

                # A single seed has no spread to test against, and _is_significantly_better
                # divides by ``n - 1`` when it has one — so the two have to agree even if a
                # scorer ever writes a sem alongside n=1.
                summary[key] = {
                    metric: (stats["mean"], stats.get("sem") if seeds > 1 else None, seeds)
                }

    return summary


def rank_submissions(
    submissions: Iterable[Submission],
    tasks: Iterable[Task],
) -> dict[str, dict[str, float]]:
    """Rank ``submissions`` against each other, per task.

    @returns ``{submission_id: {task_id: average rank}}``, empty for a submission with
             nothing scored. One rank per task rather than one overall: every figure the
             leaderboard shows — a metric group, the overall column — is a mean over this,
             and averaging is the caller's to do because only it knows what it is grouping.
    """
    metrics = primary_metrics(tasks)
    summary = _summary(submissions, metrics)

    if not summary:
        return {}

    # Only the tasks actually present: rank() raises on a task it was promised a metric for
    # and then couldn't find, and a task nobody has been scored on has no ranking to do.
    present = {task for _, task, _ in summary}

    # rank() warns per task where some recording has fewer than two models on it — nothing
    # to compare there, so that recording's rank is trivial rather than statistical. Worth
    # a log line, not worth failing over, and not worth letting through to stderr on every
    # request.
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")

        by_task = rank_labels(
            summary,
            {task: metrics[task] for task in present},
            alpha=ALPHA,
            method=METHOD,
        )

    for warning in caught:
        logger.info("leaderboard ranking: %s", warning.message)

    ranks: dict[str, dict[str, float]] = defaultdict(dict)

    for task, per_label in by_task.items():
        for label, value in per_label.items():
            ranks[label][task] = value

    return dict(ranks)
