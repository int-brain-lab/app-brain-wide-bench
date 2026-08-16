"""Tests for the leaderboard router.

The one endpoint with no notion of a caller: it publishes public, finished work and
nothing else. A private submission is absent whatever its scores, and so is one still
being scored — the leaderboard is a table of results, not of attempts.
"""

from app.models import UserTeam
from tests.conftest import SUBMISSIONS, TEAMS

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


async def test_membership_makes_no_difference(seeded_client, add, me):
    """It is the public view even for someone who can see the private rows elsewhere."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    assert labels(await seeded_client.get(LEADERBOARD_URL)) == ["mlp-ts1-baseline"]
