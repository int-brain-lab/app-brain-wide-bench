"""Tests for GET /api/models/{id}/ranking — where a model stands, publicly and privately.

Two rankings against one field, so that the difference between them is exactly what
publishing the private work would change. The tests build their own competitors: the
api_tests fixture's scores predate the per-recording `metrics` JSON the Welch test reads,
so nothing in it can be ranked at all, which makes it inert background here.

The world each test runs against — one rival and one target, both on the caller's team:

  rival-net    public   0.5 everywhere
  target-net   public   0.1 everywhere, older
               private  0.9 on three of them, plus a task the public side never entered
"""

import uuid
from datetime import datetime

import pytest_asyncio

from app.models import Model, Submission, SubmissionStatus, TaskScore, TaskSubmission, UserTeam
from tests.conftest import MODELS, TEAMS

MY_TEAM = TEAMS["Brain Wide Bench"]

# Which metric each task is scored in — the key the ranking looks for inside the JSON.
METRICS = {
    "ts1-choice": "bacc",
    "ts1-reward": "bacc",
    "ts2-co_smoothing": "poisson_d2",
    "ts2-forecasting": "poisson_d2",
    "ts3-cosmos": "macro/f1-score",
}

# TS3 has no recording dimension; everything else is scored per recording.
RECORDINGS = {"ts3-cosmos": [None]}

PUBLIC_AT = datetime(2026, 5, 1, 9, 0, 0)
PRIVATE_AT = datetime(2026, 6, 1, 9, 0, 0)


def ranking_url(model_id):
    return f"/api/models/{model_id}/ranking"


def score_json(task_id, mean, sem=0.01, seeds=5):
    """A TaskScore's per-recording breakdown — the same mean on each of the task's recordings."""
    return {
        "recordings": [
            {
                "label": "run",
                "recording_id": recording,
                "metrics": {METRICS[task_id]: {"mean": mean, "sem": sem, "n": seeds}},
            }
            for recording in RECORDINGS.get(task_id, ["rec-1", "rec-2"])
        ]
    }


async def submit(add, model_id, label, scores, *, is_public, created_at):
    """Insert one completed submission scoring ``{task_id: mean}``.

    @returns ``{task_id: TaskSubmission}`` — the entries, for asserting which one a
             ranking used.
    """
    submission = Submission(
        model_id=model_id,
        label=label,
        s3_key=f"submissions/{label}.zip",
        status=SubmissionStatus.done,
        is_public=is_public,
        created_at=created_at,
    )

    entries = {task_id: TaskSubmission(submission_id=submission.id, task_id=task_id) for task_id in scores}

    await add(
        submission,
        *entries.values(),
        *(
            TaskScore(
                task_submission_id=entries[task_id].id,
                n_seeds=5,
                primary_metric_mean=mean,
                primary_metric_sem=0.01,
                metrics=score_json(task_id, mean),
            )
            for task_id, mean in scores.items()
        ),
    )

    return entries


@pytest_asyncio.fixture
async def scenario(seeded_client, add, me):
    """The rival, the target and the caller's membership of the team that owns them."""
    rival = Model(team_id=MY_TEAM, name="rival-net")
    target = Model(team_id=MY_TEAM, name="target-net")

    await add(rival, target, UserTeam(user_id=me, team_id=MY_TEAM))

    await submit(
        add,
        rival.id,
        "rival-run",
        {task_id: 0.5 for task_id in ("ts1-choice", "ts1-reward", "ts2-co_smoothing", "ts3-cosmos")},
        is_public=True,
        created_at=PUBLIC_AT,
    )

    public = await submit(
        add,
        target.id,
        "target-public",
        {task_id: 0.1 for task_id in ("ts1-choice", "ts1-reward", "ts2-co_smoothing", "ts3-cosmos")},
        is_public=True,
        created_at=PUBLIC_AT,
    )

    # Beats the rival on the three it re-enters, and enters one nothing else has.
    private = await submit(
        add,
        target.id,
        "target-private",
        {"ts1-choice": 0.9, "ts1-reward": 0.9, "ts2-co_smoothing": 0.9, "ts2-forecasting": 0.9},
        is_public=False,
        created_at=PRIVATE_AT,
    )

    return {"model": target.id, "public": public, "private": private}


# ── the two rankings ─────────────────────────────────────────────────────────


async def test_the_private_ranking_is_what_publishing_would_earn(seeded_client, scenario):
    """One response, both sides, placed against the same two-model field.

    Publicly the target loses every task to the rival; privately it wins the three it
    re-entered. So every figure improves, and none of the field sizes move — the rival is
    the same competitor in both.
    """
    response = await seeded_client.get(ranking_url(scenario["model"]))

    assert response.status_code == 200

    body = response.json()
    public, private = body["public"], body["private"]

    # Beaten on all four tasks: second in every suite, and second overall.
    assert public["overall"]["rank"] == 2
    assert public["overall"]["mean_rank"] == 2.0
    assert {suite: place["rank"] for suite, place in public["suites"].items()} == {
        "ts1": 2,
        "ts2": 2,
        "ts3": 2,
    }

    # Winning ts1 and ts2 while still losing ts3 is enough to lead overall.
    assert private["overall"]["rank"] == 1
    assert private["overall"]["mean_rank"] < public["overall"]["mean_rank"]
    assert {suite: place["rank"] for suite, place in private["suites"].items()} == {
        "ts1": 1,
        "ts2": 1,
        "ts3": 2,
    }

    # A suite it has never entered is absent rather than placed last.
    assert set(public["suites"]) == {"ts1", "ts2", "ts3"}

    # The field is the rival plus the model itself, whichever side is being asked about.
    assert public["overall"]["n_ranked"] == private["overall"]["n_ranked"] == 2
    assert public["suites"]["ts1"]["n_ranked"] == 2

    # Both sides entered every suite, which is what earns an overall position at all.
    assert public["overall"]["suites_scored"] == public["overall"]["suites_total"] == 3


async def test_tasks_name_the_entry_behind_each_side(seeded_client, scenario):
    """Which score each ranking used, so a score table can mark its own rows.

    Three shapes, all in one response: a task the private side re-entered (different
    entries), one it didn't (the same entry serves both), and one only it has.
    """
    body = (await seeded_client.get(ranking_url(scenario["model"]))).json()

    tasks = body["tasks"]
    public, private = scenario["public"], scenario["private"]

    assert set(tasks) == {
        "ts1-choice",
        "ts1-reward",
        "ts2-co_smoothing",
        "ts2-forecasting",
        "ts3-cosmos",
    }

    # Re-entered privately: the public side falls back to the older public entry.
    choice = tasks["ts1-choice"]

    assert choice["public"]["id"] == str(public["ts1-choice"].id)
    assert choice["private"]["id"] == str(private["ts1-choice"].id)
    assert choice["public"]["submission_id"] != choice["private"]["submission_id"]

    # Not re-entered: the same public score stands in both rankings.
    assert tasks["ts3-cosmos"]["public"] == tasks["ts3-cosmos"]["private"]

    # Entered only privately: nothing public to rank, so publishing would add it.
    assert tasks["ts2-forecasting"]["public"] is None
    assert tasks["ts2-forecasting"]["private"]["id"] == str(private["ts2-forecasting"].id)


async def test_overall_rank_waits_for_every_suite(seeded_client, add, me):
    """A model in one suite is placed in it, but not against models that entered three.

    The mean is still reported — it is the position that is withheld, and the coverage
    counts beside it are what say why.
    """
    partial = Model(team_id=MY_TEAM, name="ts1-only-net")

    await add(partial, UserTeam(user_id=me, team_id=MY_TEAM))
    await submit(add, partial.id, "ts1-only", {"ts1-choice": 0.7}, is_public=True, created_at=PUBLIC_AT)

    body = (await seeded_client.get(ranking_url(partial.id))).json()

    assert body["public"]["suites"]["ts1"]["rank"] == 1
    assert body["public"]["overall"]["rank"] is None
    assert body["public"]["overall"]["mean_rank"] == 1.0
    assert body["public"]["overall"]["suites_scored"] == 1
    assert body["public"]["overall"]["suites_total"] == 3


# ── who may see what ─────────────────────────────────────────────────────────


async def test_private_is_withheld_from_a_non_member(seeded_client):
    """The public ranking is public; the other side is a claim about work they can't see.

    mlp-baseline has both a public submission and newer private ones, and the caller is
    a member of nothing until a test says otherwise.
    """
    body = (await seeded_client.get(ranking_url(MODELS["mlp-baseline"]))).json()

    assert body["public"] is not None
    assert body["private"] is None

    # And nothing private leaks through the entries either.
    assert all(entry["private"] is None for entry in body["tasks"].values())


async def test_a_model_with_nothing_public_is_not_found(seeded_client):
    """Same rule as the model detail: unreadable, rather than readable and empty."""
    response = await seeded_client.get(ranking_url(MODELS["ssl-transformer"]))

    assert response.status_code == 404


async def test_an_unknown_model_is_not_found(seeded_client):
    assert (await seeded_client.get(ranking_url(uuid.uuid4()))).status_code == 404
