"""Leaderboard ranking over the per-recording scores already in the database.

The benchmark's own ranking lives in ``core.scoring.aggregation.rank``: for each
``(task, recording_id)`` it orders models by that task's primary metric, promoting one past
the current anchor only when a one-sided Welch's t-test finds it significantly better, then
averages those per-recording ranks within each task. This module is the adapter — it
reshapes what we store into the shape that function takes, and nothing more. The statistics
are not reimplemented here, deliberately: a second copy would be a second thing to disagree
with the published numbers.

Ranks are computed over exactly the standings handed in, so narrowing the leaderboard
narrows the field a model is ranked against rather than merely hiding rows.
"""

import logging
import uuid
import warnings
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from typing import Iterable, Mapping

from core.scoring.aggregation import NO_RECORDING_ID, rank as rank_labels

from app.models import Submission, Task, TaskSubmission

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


# ── Standings ─────────────────────────────────────────────────────────────────


def _recency(submission: Submission) -> tuple:
    """Sort key putting the newest submission first under ``reverse=True``.

    An unflushed submission has no timestamp yet, and its ``False`` sorts it last without
    the tuple ever comparing ``datetime.min`` against a real one — mixing naive and aware
    timestamps raises. The id breaks ties, so a batch inserted within the same clock tick
    orders the same way twice; which of them wins is arbitrary, that it is stable isn't.
    """
    return (submission.created_at is not None, submission.created_at or datetime.min, str(submission.id))


def latest_entries(submissions: Iterable[Submission]) -> dict[str, TaskSubmission]:
    """``{task_id: TaskSubmission}`` — the newest scored entry for each task.

    Across submissions, not within one: a task scored in an earlier run and not re-entered
    in the latest one is still the current result for it. Which submission each entry came
    from is on the entry itself.
    """
    entries: dict[str, TaskSubmission] = {}

    for submission in sorted(submissions, key=_recency, reverse=True):
        for task_submission in submission.task_submissions:
            if task_submission.score is not None:
                entries.setdefault(task_submission.task_id, task_submission)

    return entries


@dataclass(frozen=True)
class Standing:
    """Where one competitor currently stands: its newest score for each task.

    The unit of ranking, in place of the submission. Ranking whole submissions would have
    a model judged on its most recent run alone, dropping every task that run didn't
    re-enter; a standing keeps them, and so answers "how does this model place today"
    rather than "how did this upload place".

    ``latest`` is the newest submission behind it — what a row links to and dates itself
    by, even where the scores beside it came from older ones. ``n_submissions`` counts them
    all, including the ones every score has since been superseded from: a reader counting
    submissions is counting work done, not work still showing.

    No team of its own: a model belongs to one team, so whose standing this is follows from
    the model, and a caller that needs to say so reads it off ``latest``.
    """

    label: str
    entries: dict[str, TaskSubmission]
    model_id: uuid.UUID | None = None
    latest: Submission | None = None
    n_submissions: int = 0


def standings(submissions: Iterable[Submission]) -> list[Standing]:
    """One standing per model, ordered by its newest submission, newest first.

    The model is the competitor, and it is one competitor however many times it has been
    submitted or whoever submitted it: a submission belongs to a model, and the model to a
    team, so there is nothing finer to key on.
    """
    by_model: dict[uuid.UUID, list[Submission]] = defaultdict(list)

    for submission in submissions:
        by_model[submission.model_id].append(submission)

    ranked = [
        Standing(
            label=str(model_id),
            entries=latest_entries(group),
            model_id=model_id,
            latest=max(group, key=_recency),
            n_submissions=len(group),
        )
        for model_id, group in by_model.items()
    ]

    return sorted(ranked, key=lambda standing: _recency(standing.latest), reverse=True)


# ── Ranking ───────────────────────────────────────────────────────────────────


def _summary(
    standings: Iterable[Standing],
    metrics: Mapping[str, str],
) -> dict[tuple[str, str, str], dict[str, tuple[float, float | None, int]]]:
    """Build ``rank()``'s input from ``TaskScore.metrics["recordings"]``.

    Labelled by the standing. Not the ``label`` inside the JSON, which is free text the
    submitter chose and already collides across submissions in our own baselines.

    TS3 has no recording dimension, so its rows carry no ``recording_id`` and take the
    sentinel ``aggregate()`` would have given them.
    """
    summary: dict[tuple[str, str, str], dict[str, tuple[float, float | None, int]]] = {}

    for standing in standings:
        for task_id, task_submission in standing.entries.items():
            metric = metrics.get(task_id)

            if metric is None:
                continue

            for row in (task_submission.score.metrics or {}).get("recordings", []):
                stats = (row.get("metrics") or {}).get(metric)

                if not stats or stats.get("mean") is None:
                    continue

                seeds = stats.get("n") or 1

                key = (standing.label, task_id, row.get("recording_id") or NO_RECORDING_ID)

                # A single seed has no spread to test against, and _is_significantly_better
                # divides by ``n - 1`` when it has one — so the two have to agree even if a
                # scorer ever writes a sem alongside n=1.
                summary[key] = {
                    metric: (stats["mean"], stats.get("sem") if seeds > 1 else None, seeds)
                }

    return summary


def rank_standings(
    standings: Iterable[Standing],
    tasks: Iterable[Task],
) -> dict[str, dict[str, float]]:
    """Rank ``standings`` against each other, per task.

    @returns ``{standing label: {task_id: average rank}}``, empty for a standing with
             nothing scored. One rank per task rather than one overall: every figure built
             on top — a suite, the overall column — is a mean over this, and averaging is
             the caller's to do because only it knows what it is grouping.
    """
    metrics = primary_metrics(tasks)
    summary = _summary(standings, metrics)

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


# ── Placings ──────────────────────────────────────────────────────────────────
#
# The figures built on top of the per-task ranks: one per suite, and one overall. Ranks are
# unitless, so averaging them across tasks and across metrics is arithmetic that means
# something — averaging the scores underneath them would not be, which is why there is no
# suite-level score anywhere in this file.

# Ties within this are the same rank. Ranks are averages of small integers, so anything
# closer than this is float noise rather than a real difference.
EPSILON = 1e-10


def _mean(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def competition_ranks(values: Mapping[str, float]) -> dict[str, int]:
    """Standard competition ranking (1224) over ``values``, smallest first.

    Ties share a rank and the next one is skipped, so two models in second place are both
    2nd and the one behind them is 4th. Only labels that have a value are returned — what
    a missing one means is the caller's to decide, and "last" is rarely it.
    """
    ordered = sorted(values.items(), key=lambda item: item[1])
    ranks: dict[str, int] = {}

    for index, (label, value) in enumerate(ordered):
        previous_label, previous_value = ordered[index - 1] if index else (None, None)

        tied = previous_label is not None and abs(value - previous_value) < EPSILON

        ranks[label] = ranks[previous_label] if tied else index + 1

    return ranks


@dataclass(frozen=True)
class Placing:
    """Where a standing placed on one figure, and against how many.

    ``mean_rank`` is the mean of the per-task ranks the figure covers, and ``rank`` is the
    position that mean earned. The position can be absent while the mean is not: an overall
    mean is reported for anyone, but only a model that entered every suite is placed on it.
    """

    rank: int | None = None
    mean_rank: float | None = None
    n_ranked: int = 0


@dataclass(frozen=True)
class Placings:
    """One standing's position on every figure — overall, and within each suite.

    ``suites`` holds only the suites the standing was actually ranked in; a suite it never
    entered has no position to report rather than a last place.

    ``suites_scored`` against ``suites_total`` is why ``overall.rank`` may be absent: a
    model is placed overall only once it has entered every suite. Averaging over "the
    suites you entered" would make entering fewer of them strictly easier — first in your
    only suite would beat second in all three.
    """

    overall: Placing
    suites: dict[str, Placing]
    suites_scored: int = 0
    suites_total: int = 0


def place_standings(
    standings: Iterable[Standing],
    tasks: Iterable[Task],
) -> dict[str, Placings]:
    """Rank ``standings`` against each other, per suite and overall.

    The whole field in one call, because a position only exists relative to one: every
    figure here is a competition rank over the same set of standings, and adding or
    removing one of them moves the others.

    @returns ``{standing label: Placings}``, with an entry for every standing handed in.
    """
    standings = list(standings)
    ranks = rank_standings(standings, tasks)

    suite_of = {task.id: task.task_suite.value for task in tasks}

    # Sorted so the suites come back ts1, ts2, ts3 — a client iterating them is drawing
    # columns, and a set's order would redraw them differently between requests.
    every_suite = sorted(set(suite_of.values()))

    # Per figure, the mean each standing earned on it — the input to one competition
    # ranking each. Built for the whole field first because a position needs all of them.
    overall_means: dict[str, float] = {}
    suite_means: dict[str, dict[str, float]] = {suite: {} for suite in every_suite}
    coverage: dict[str, int] = {}

    for standing in standings:
        task_ranks = ranks.get(standing.label, {})

        by_suite: dict[str, list[float]] = defaultdict(list)

        for task_id, value in task_ranks.items():
            by_suite[suite_of[task_id]].append(value)

        for suite, values in by_suite.items():
            suite_means[suite][standing.label] = _mean(values)

        # Counted on the scores rather than on the ranks: a task nobody else entered still
        # produces a rank of 1, and coverage is about what was attempted. A task this
        # ranking wasn't given is skipped here as it is everywhere else in the module.
        coverage[standing.label] = len(
            {suite_of[task_id] for task_id in standing.entries if task_id in suite_of}
        )

        mean_rank = _mean(list(task_ranks.values()))

        if mean_rank is not None and coverage[standing.label] == len(every_suite):
            overall_means[standing.label] = mean_rank

    overall_ranks = competition_ranks(overall_means)
    suite_ranks = {suite: competition_ranks(means) for suite, means in suite_means.items()}

    placings: dict[str, Placings] = {}

    for standing in standings:
        label = standing.label
        task_ranks = ranks.get(label, {})

        placings[label] = Placings(
            # The mean is reported whether or not it earned a position, so a partially
            # covered model can still be told where it stands.
            overall=Placing(
                rank=overall_ranks.get(label),
                mean_rank=_mean(list(task_ranks.values())),
                n_ranked=len(overall_means),
            ),
            suites={
                suite: Placing(
                    rank=suite_ranks[suite][label],
                    mean_rank=means[label],
                    n_ranked=len(means),
                )
                for suite, means in suite_means.items()
                if label in means
            },
            suites_scored=coverage[label],
            suites_total=len(every_suite),
        )

    return placings
