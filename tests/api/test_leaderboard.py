"""Tests for the leaderboard router.

The one endpoint with no notion of a caller: it publishes public, finished work and
nothing else. A private submission is absent whatever its scores, and so is one still
being scored — the leaderboard is a table of results, not of attempts.

A row is a model's standing rather than a submission: its newest public score for each
task, which is also what the ranks are computed over. So the collapsing tests here are
about what a row is made of, not merely about which rows are shown.

Who is asking must change nothing at all — not which rows come back, and not one field on
any of them. ``test_membership_makes_no_difference`` pins that down field by field, which
is what a client marking the reader's own rows relies on: it intersects ``team_id`` against
its own team list rather than expecting this response to say.
"""

from datetime import datetime

from app.models import Submission, SubmissionStatus, TaskScore, TaskSubmission, UserTeam
from tests.conftest import MODELS, SUBMISSIONS, TASK_SUBMISSIONS, TEAMS

BASELINE = SUBMISSIONS["mlp-ts1-baseline"]

MY_TEAM = TEAMS["Brain Wide Bench"]

LEADERBOARD_URL = "/api/leaderboard"


def labels(response):
    """Return leaderboard labels in a stable order."""
    return sorted(row["label"] for row in response.json())


async def test_lists_public_finished_submissions_only(seeded_client):
    """Four of the five fixture submissions are private or pending, so one row."""
    response = await seeded_client.get(LEADERBOARD_URL)

    assert response.status_code == 200
    assert labels(response) == ["mlp-ts1-baseline"]


async def test_row_names_its_model_and_team(seeded_client):
    """Identified by the newest submission behind the standing — here, the only one."""
    row = (await seeded_client.get(LEADERBOARD_URL)).json()[0]

    assert row["id"] == str(BASELINE)
    assert row["model_id"] == str(MODELS["mlp-baseline"])
    assert row["model_name"] == "mlp-baseline"
    assert row["team_id"] == str(MY_TEAM)
    assert row["team_name"] == "Brain Wide Bench"
    assert row["created_at"]


async def test_row_carries_a_score_per_task(seeded_client):
    """Keyed by flat task id, so the frontend can build one column per task.

    Each score says which metric it is in and which entry it came from, so a client can
    label it and link back to it without joining anything.
    """
    row = (await seeded_client.get(LEADERBOARD_URL)).json()[0]

    assert len(row["scores"]) == 8

    reward = row["scores"]["ts1-reward"]

    assert reward["mean"] == 0.85
    assert reward["sem"] == 0.02
    assert reward["n_seeds"] == 5
    assert reward["metric"] == "bacc"
    assert reward["task_submission_id"] == str(TASK_SUBMISSIONS["mlp-ts1-baseline"]["ts1-reward"])
    assert reward["submission_id"] == str(BASELINE)

    # mlp-ts1-rerun is newer and scored 0.74 here, but it is private: a standing is built
    # from what the caller may see, and this caller may see nothing private.
    assert row["scores"]["ts1-choice"]["mean"] == 0.72


async def test_a_row_is_a_standing_across_submissions(seeded_client, add):
    """A second public run doesn't replace the first — it updates the tasks it re-entered.

    So one row still, named and dated by the newest submission, carrying its score where
    it has one and the older score everywhere else. Which is which is on the score.
    """
    newer = Submission(
        team_id=MY_TEAM,
        model_id=MODELS["mlp-baseline"],
        label="mlp-ts1-v2",
        s3_key="submissions/v2.zip",
        status=SubmissionStatus.done,
        is_public=True,
        created_at=datetime(2026, 8, 1, 9, 0, 0),
    )
    choice = TaskSubmission(submission_id=newer.id, task_id="ts1-choice")
    cosmos = TaskSubmission(submission_id=newer.id, task_id="ts3-cosmos")

    await add(
        newer,
        choice,
        cosmos,
        TaskScore(task_submission_id=choice.id, n_seeds=3, primary_metric_mean=0.91),
        TaskScore(task_submission_id=cosmos.id, n_seeds=3, primary_metric_mean=0.40),
    )

    rows = (await seeded_client.get(LEADERBOARD_URL)).json()

    assert len(rows) == 1

    [row] = rows

    assert row["id"] == str(newer.id)
    assert row["label"] == "mlp-ts1-v2"

    # The count is the row's own, since there is no longer a row per submission to count.
    assert row["n_submissions"] == 2

    # Eight from the baseline, plus the task only the newer run entered.
    assert len(row["scores"]) == 9

    assert row["scores"]["ts1-choice"]["mean"] == 0.91
    assert row["scores"]["ts1-choice"]["submission_id"] == str(newer.id)
    assert row["scores"]["ts3-cosmos"]["submission_id"] == str(newer.id)

    # A task the newer run didn't re-enter keeps the earlier score, and says where it is from.
    assert row["scores"]["ts1-reward"]["mean"] == 0.85
    assert row["scores"]["ts1-reward"]["submission_id"] == str(BASELINE)


async def test_row_carries_a_rank_per_task(seeded_client):
    """Present on every row, and empty for a score with no per-recording breakdown.

    The fixture's task_scores predate the `metrics` JSON, so there is nothing for the Welch
    test to run on — the endpoint has to say "unranked" rather than fail. app/ranking.py's
    own tests cover the case where the breakdown is there.
    """
    row = (await seeded_client.get(LEADERBOARD_URL)).json()[0]

    assert row["ranks"] == {}


# ── the pretrained filter ────────────────────────────────────────────────────
#
# The one public+done fixture submission belongs to mlp-baseline, which is not pretrained.
# ssl-transformer is, and unsubmitted-net says nothing either way — neither has a submission
# on the board, which is what makes "no rows" the right answer rather than an accident.


async def test_unfiltered_includes_every_model(seeded_client):
    assert labels(await seeded_client.get(LEADERBOARD_URL)) == ["mlp-ts1-baseline"]


async def test_filters_to_models_that_are_not_pretrained(seeded_client):
    response = await seeded_client.get(LEADERBOARD_URL, params={"is_pretrained": "false"})

    assert labels(response) == ["mlp-ts1-baseline"]


async def test_filters_out_models_that_are_not_pretrained(seeded_client):
    response = await seeded_client.get(LEADERBOARD_URL, params={"is_pretrained": "true"})

    assert response.status_code == 200
    assert response.json() == []


async def test_an_unanswered_pretrained_flag_matches_neither_value(seeded_client, add):
    """Nullable, so "not filled in" is its own state — not a quiet "no"."""
    model = MODELS["unsubmitted-net"]

    await add(
        Submission(
            team_id=MY_TEAM,
            model_id=model,
            label="mystery-run",
            s3_key="submissions/mystery.zip",
            status=SubmissionStatus.done,
            is_public=True,
        )
    )

    assert "mystery-run" in labels(await seeded_client.get(LEADERBOARD_URL))

    for value in ("true", "false"):
        response = await seeded_client.get(LEADERBOARD_URL, params={"is_pretrained": value})

        assert "mystery-run" not in labels(response)


async def test_membership_makes_no_difference(seeded_client, add, me):
    """It is the public view even for someone who can see the private rows elsewhere.

    The whole response, not just the labels: membership must not move a single field. A
    future field that varied by caller — an ``is_mine`` computed here rather than in the
    client — would fail this, which is the point.
    """
    anonymous = (await seeded_client.get(LEADERBOARD_URL)).json()

    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.get(LEADERBOARD_URL)

    assert labels(response) == ["mlp-ts1-baseline"]
    assert response.json() == anonymous
