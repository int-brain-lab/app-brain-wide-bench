"""Tests for app.ranking — the adapter between stored scores and the benchmark's rank().

The statistics belong to ``core.scoring.aggregation`` and are not retested here. What is
tested is everything this module actually decides: what a competitor is, which of its
scores count, how the stored JSON is reshaped, and what happens when it isn't there.
"""

import uuid
from datetime import datetime, timedelta
from types import SimpleNamespace

from app.models import Metric, TaskSuite
from app.ranking import (
    competition_ranks,
    latest_entries,
    place_standings,
    primary_metrics,
    rank_standings,
    standings,
)

NOW = datetime(2026, 8, 1, 12, 0, 0)

# Two suites, so that "entered every suite" is a state a test can be in or out of.
TASKS = [
    SimpleNamespace(id="ts1-choice", task_suite=TaskSuite.ts1, primary_metric=Metric.bacc),
    SimpleNamespace(id="ts1-wheel_speed", task_suite=TaskSuite.ts1, primary_metric=Metric.r2),
    SimpleNamespace(id="ts3-cosmos", task_suite=TaskSuite.ts3, primary_metric=Metric.f1_macro),
]


def score(metric: str, per_recording: list[tuple[str | None, float]], sem=0.01, n=5):
    """A TaskScore-shaped stand-in: the recordings JSON is all rank() reads."""
    return SimpleNamespace(
        metrics={
            "recordings": [
                {
                    "label": "whoever",
                    "recording_id": recording,
                    "metrics": {metric: {"mean": mean, "sem": sem, "n": n}},
                }
                for recording, mean in per_recording
            ]
        }
    )


def submission(model_id, task_scores, *, created_at=NOW):
    submission_id = uuid.uuid4()

    return SimpleNamespace(
        id=submission_id,
        model_id=model_id,
        created_at=created_at,
        task_submissions=[
            SimpleNamespace(id=uuid.uuid4(), submission_id=submission_id, task_id=task_id, score=value)
            for task_id, value in task_scores.items()
        ],
    )


def ranks_by_model(*submissions):
    """Rank the standings these submissions make, keyed by model id — which is the label."""
    ranked = rank_standings(standings(list(submissions)), TASKS)

    return {s.model_id: ranked.get(str(s.model_id), {}) for s in submissions}


# ── what competes ────────────────────────────────────────────────────────────


def test_a_standing_holds_the_newest_score_for_each_task():
    """Across submissions, not within one — and the newest submission identifies it.

    The rerun re-entered only one of the two tasks, so the earlier score for the other is
    still this model's current result for it. A task submission with no score is not one.
    """
    model = uuid.uuid4()
    first = submission(
        model,
        {"ts1-choice": score("bacc", [("a", 0.1)]), "ts1-wheel_speed": score("r2", [("a", 0.5)])},
        created_at=NOW - timedelta(days=1),
    )
    rerun = submission(
        model,
        {"ts1-choice": score("bacc", [("a", 0.9)]), "ts3-cosmos": None},
        created_at=NOW,
    )

    [standing] = standings([first, rerun])

    assert set(standing.entries) == {"ts1-choice", "ts1-wheel_speed"}
    assert standing.entries["ts1-choice"].submission_id == rerun.id
    assert standing.entries["ts1-wheel_speed"].submission_id == first.id
    assert standing.latest is rerun


def test_one_standing_per_model():
    """A model competes once however often it has been submitted, and is labelled by its id."""
    model, rival = uuid.uuid4(), uuid.uuid4()
    submissions = [submission(model, {}), submission(model, {}), submission(rival, {})]

    labels = {standing.label for standing in standings(submissions)}

    assert labels == {str(model), str(rival)}


def test_entries_are_stable_when_submissions_share_a_timestamp():
    """Second-resolution timestamps tie; which entry wins is arbitrary, that it is fixed isn't."""
    model = uuid.uuid4()
    tied = [
        submission(model, {"ts1-choice": score("bacc", [("a", value)])})
        for value in (0.1, 0.9)
    ]

    assert latest_entries(tied) == latest_entries(reversed(tied))


# ── the reshaping ────────────────────────────────────────────────────────────


def test_primary_metrics_uses_the_metric_name():
    """Matched against the JSON's keys, which the scorer wrote as plain strings."""
    assert primary_metrics(TASKS)["ts3-cosmos"] == "macro/f1-score"


def test_ranks_each_task_separately():
    recordings = [("rec-1", 0.9), ("rec-2", 0.9)]
    weaker = [("rec-1", 0.1), ("rec-2", 0.1)]

    best = submission(uuid.uuid4(), {"ts1-choice": score("bacc", recordings)})
    worst = submission(uuid.uuid4(), {"ts1-choice": score("bacc", weaker)})

    ranks = ranks_by_model(best, worst)

    assert ranks[best.model_id] == {"ts1-choice": 1.0}
    assert ranks[worst.model_id] == {"ts1-choice": 2.0}


def test_rank_is_averaged_over_recordings():
    """Winning one recording and losing the other is rank 1.5, not a tie."""
    swings = submission(uuid.uuid4(), {"ts1-choice": score("bacc", [("a", 0.9), ("b", 0.1)])})
    steady = submission(uuid.uuid4(), {"ts1-choice": score("bacc", [("a", 0.1), ("b", 0.9)])})

    ranks = ranks_by_model(swings, steady)

    assert ranks[swings.model_id]["ts1-choice"] == 1.5
    assert ranks[steady.model_id]["ts1-choice"] == 1.5


def test_a_suite_without_recordings_still_ranks():
    """TS3 scores carry no recording_id; aggregate()'s sentinel stands in for one."""
    first = submission(uuid.uuid4(), {"ts3-cosmos": score("macro/f1-score", [(None, 0.7)])})
    second = submission(uuid.uuid4(), {"ts3-cosmos": score("macro/f1-score", [(None, 0.6)])})

    ranks = ranks_by_model(first, second)

    assert ranks[first.model_id]["ts3-cosmos"] == 1.0
    assert ranks[second.model_id]["ts3-cosmos"] == 2.0


def test_a_model_is_ranked_on_every_task_it_has_a_current_score_for():
    """Including one entered only in an older submission — that is what a standing is for."""
    model = uuid.uuid4()
    old = submission(
        model, {"ts1-wheel_speed": score("r2", [("a", 0.5)])},
        created_at=NOW - timedelta(days=1),
    )
    new = submission(model, {"ts1-choice": score("bacc", [("a", 0.9)])})
    rival = submission(uuid.uuid4(), {"ts1-choice": score("bacc", [("a", 0.1)])})

    ranks = ranks_by_model(old, new, rival)

    assert set(ranks[model]) == {"ts1-choice", "ts1-wheel_speed"}
    assert set(ranks[rival.model_id]) == {"ts1-choice"}


# ── what happens when the data isn't there ───────────────────────────────────


def test_nothing_rankable_ranks_nothing():
    """Every way a score can fail to be one, each of which must be skipped, not raise."""
    unscored = submission(uuid.uuid4(), {"ts1-choice": None})

    # The pre-2026-08 rows: a mean and a sem, but no `recordings` to test against.
    bare = submission(uuid.uuid4(), {"ts1-choice": SimpleNamespace(metrics=None)})

    # Scored only in something other than the task's primary metric.
    wrong_metric = submission(uuid.uuid4(), {"ts1-choice": score("f1", [("a", 0.9)])})

    # A task the lookup table doesn't have.
    unknown_task = submission(uuid.uuid4(), {"ts9-mystery": score("bacc", [("a", 0.9)])})

    for lone in (unscored, bare, wrong_metric, unknown_task):
        assert rank_standings(standings([lone]), TASKS) == {}

        # The figures built on top walk the same entries, so they skip the same things.
        assert place_standings(standings([lone]), TASKS)


# ── the figures built on the ranks ───────────────────────────────────────────


def test_competition_ranks_share_a_place_and_skip_the_next():
    """1224: two models tied for first are both 1st, and the next one is 3rd."""
    assert competition_ranks({"a": 1.0, "b": 1.0, "c": 2.0}) == {"a": 1, "b": 1, "c": 3}


def test_placings_place_every_suite_but_withhold_a_partial_overall():
    """TASKS spans two suites, so a model in one of them is the partially covered case.

    It is still placed in the suite it entered — the position withheld is the overall one,
    and the coverage counts beside it are what say why.
    """
    both = submission(
        uuid.uuid4(),
        {
            "ts1-choice": score("bacc", [("a", 0.9)]),
            "ts3-cosmos": score("macro/f1-score", [(None, 0.9)]),
        },
    )
    ts1_only = submission(uuid.uuid4(), {"ts1-choice": score("bacc", [("a", 0.1)])})

    placings = place_standings(standings([both, ts1_only]), TASKS)

    covered = placings[str(both.model_id)]
    partial = placings[str(ts1_only.model_id)]

    assert covered.overall.rank == 1
    assert {suite: placing.rank for suite, placing in covered.suites.items()} == {"ts1": 1, "ts3": 1}

    # Second in the suite it entered, and unplaced overall — but the mean is still reported.
    assert partial.suites["ts1"].rank == 2
    assert set(partial.suites) == {"ts1"}
    assert partial.overall.rank is None
    assert partial.overall.mean_rank == 2.0
    assert (partial.suites_scored, partial.suites_total) == (1, 2)

    # The overall field is only who qualified for it; the suite's is everyone in that suite.
    assert covered.overall.n_ranked == 1
    assert covered.suites["ts1"].n_ranked == 2
