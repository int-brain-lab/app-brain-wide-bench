"""Tests for app.ranking — the adapter between stored scores and the benchmark's rank().

The statistics belong to ``core.scoring.aggregation`` and are not retested here. What is
tested is everything this module actually decides: which submissions compete, how the
stored JSON is reshaped, and what happens when it isn't there.
"""

import uuid
from datetime import datetime, timedelta
from types import SimpleNamespace

from app.models import Metric
from app.ranking import latest_per_model_team, primary_metrics, rank_submissions

NOW = datetime(2026, 8, 1, 12, 0, 0)

TASKS = [
    SimpleNamespace(id="ts1-choice", primary_metric=Metric.bacc),
    SimpleNamespace(id="ts1-wheel_speed", primary_metric=Metric.r2),
    SimpleNamespace(id="ts3-cosmos", primary_metric=Metric.f1_macro),
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


def submission(model_id, task_scores, *, team_id=None, created_at=NOW):
    return SimpleNamespace(
        id=uuid.uuid4(),
        model_id=model_id,
        team_id=team_id or uuid.uuid4(),
        created_at=created_at,
        task_submissions=[
            SimpleNamespace(task_id=task_id, score=value)
            for task_id, value in task_scores.items()
        ],
    )


# ── which submissions compete ────────────────────────────────────────────────


def test_latest_per_model_team_keeps_the_newest():
    model, team = uuid.uuid4(), uuid.uuid4()
    older = submission(model, {}, team_id=team, created_at=NOW - timedelta(days=1))
    newer = submission(model, {}, team_id=team, created_at=NOW)

    assert latest_per_model_team([older, newer]) == [newer]
    assert latest_per_model_team([newer, older]) == [newer]


def test_latest_per_model_team_separates_teams():
    """A model reassigned to another team keeps the submissions made under the old one."""
    model = uuid.uuid4()
    one = submission(model, {}, team_id=uuid.uuid4())
    two = submission(model, {}, team_id=uuid.uuid4())

    assert len(latest_per_model_team([one, two])) == 2


# ── the reshaping ────────────────────────────────────────────────────────────


def test_primary_metrics_uses_the_metric_name():
    """Matched against the JSON's keys, which the scorer wrote as plain strings."""
    assert primary_metrics(TASKS)["ts3-cosmos"] == "macro/f1-score"


def test_ranks_each_task_separately():
    recordings = [("rec-1", 0.9), ("rec-2", 0.9)]
    weaker = [("rec-1", 0.1), ("rec-2", 0.1)]

    best = submission(uuid.uuid4(), {"ts1-choice": score("bacc", recordings)})
    worst = submission(uuid.uuid4(), {"ts1-choice": score("bacc", weaker)})

    ranks = rank_submissions([best, worst], TASKS)

    assert ranks[str(best.id)] == {"ts1-choice": 1.0}
    assert ranks[str(worst.id)] == {"ts1-choice": 2.0}


def test_rank_is_averaged_over_recordings():
    """Winning one recording and losing the other is rank 1.5, not a tie."""
    swings = submission(uuid.uuid4(), {"ts1-choice": score("bacc", [("a", 0.9), ("b", 0.1)])})
    steady = submission(uuid.uuid4(), {"ts1-choice": score("bacc", [("a", 0.1), ("b", 0.9)])})

    ranks = rank_submissions([swings, steady], TASKS)

    assert ranks[str(swings.id)]["ts1-choice"] == 1.5
    assert ranks[str(steady.id)]["ts1-choice"] == 1.5


def test_a_suite_without_recordings_still_ranks():
    """TS3 scores carry no recording_id; aggregate()'s sentinel stands in for one."""
    first = submission(uuid.uuid4(), {"ts3-cosmos": score("macro/f1-score", [(None, 0.7)])})
    second = submission(uuid.uuid4(), {"ts3-cosmos": score("macro/f1-score", [(None, 0.6)])})

    ranks = rank_submissions([first, second], TASKS)

    assert ranks[str(first.id)]["ts3-cosmos"] == 1.0
    assert ranks[str(second.id)]["ts3-cosmos"] == 2.0


def test_a_model_is_ranked_only_on_the_tasks_it_entered():
    both = submission(
        uuid.uuid4(),
        {
            "ts1-choice": score("bacc", [("a", 0.9)]),
            "ts1-wheel_speed": score("r2", [("a", 0.5)]),
        },
    )
    one = submission(uuid.uuid4(), {"ts1-choice": score("bacc", [("a", 0.1)])})

    ranks = rank_submissions([both, one], TASKS)

    assert set(ranks[str(both.id)]) == {"ts1-choice", "ts1-wheel_speed"}
    assert set(ranks[str(one.id)]) == {"ts1-choice"}


# ── what happens when the data isn't there ───────────────────────────────────


def test_unscored_submissions_rank_nothing():
    assert rank_submissions([submission(uuid.uuid4(), {"ts1-choice": None})], TASKS) == {}


def test_scores_without_per_recording_json_rank_nothing():
    """The pre-2026-08 rows: a mean and a sem, but no `recordings` to test against."""
    bare = submission(uuid.uuid4(), {"ts1-choice": SimpleNamespace(metrics=None)})

    assert rank_submissions([bare], TASKS) == {}


def test_a_task_missing_its_primary_metric_is_skipped():
    """A recording scored only in something else contributes nothing, rather than raising."""
    odd = submission(uuid.uuid4(), {"ts1-choice": score("f1", [("a", 0.9)])})

    assert rank_submissions([odd], TASKS) == {}


def test_a_task_the_table_doesnt_know_is_skipped():
    unknown = submission(uuid.uuid4(), {"ts9-mystery": score("bacc", [("a", 0.9)])})

    assert rank_submissions([unknown], TASKS) == {}
