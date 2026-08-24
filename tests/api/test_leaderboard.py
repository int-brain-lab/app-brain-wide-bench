"""Tests for the leaderboard router.

The one endpoint with no notion of a caller: it publishes public, finished work and
nothing else. A private submission is absent whatever its scores, and so is one still
being scored — the leaderboard is a table of results, not of attempts.
"""

from app.models import Submission, SubmissionStatus, UserTeam
from tests.conftest import MODELS, SUBMISSIONS, TEAMS

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
    row = (await seeded_client.get(LEADERBOARD_URL)).json()[0]

    assert row["id"] == str(BASELINE)
    assert row["model_name"] == "mlp-baseline"
    assert row["team_name"] == "Brain Wide Bench"
    assert row["created_at"]


async def test_row_carries_a_score_per_task(seeded_client):
    """Keyed by flat task id, so the frontend can build one column per task."""
    row = (await seeded_client.get(LEADERBOARD_URL)).json()[0]

    assert len(row["scores"]) == 8

    reward = row["scores"]["ts1-reward"]

    assert reward["mean"] == 0.85
    assert reward["sem"] == 0.02
    assert reward["n_seeds"] == 5


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
    """It is the public view even for someone who can see the private rows elsewhere."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    assert labels(await seeded_client.get(LEADERBOARD_URL)) == ["mlp-ts1-baseline"]
