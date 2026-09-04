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
    test to run on — the endpoint has to say "unranked" rather than fail. app/ranking/rank.py's
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
    mystery = Submission(
        model_id=MODELS["unsubmitted-net"],
        label="mystery-run",
        s3_key="submissions/mystery.zip",
        status=SubmissionStatus.done,
        is_public=True,
    )

    # Scored, because an unscored standing is no longer a row at all — see
    # ``test_a_model_with_nothing_left_is_not_a_row``. The flag is what this is about, so the
    # row has to exist before either value can be shown not to match it.
    choice = TaskSubmission(submission_id=mystery.id, task_id="ts1-choice")

    await add(
        mystery,
        choice,
        TaskScore(task_submission_id=choice.id, n_seeds=3, primary_metric_mean=0.5),
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


# ── the methodology filters ──────────────────────────────────────────────────
#
# A different grain from the pretrained one: these are facts about a task entry, so they take
# entries out of a standing rather than models out of the field. A model can survive carrying
# only some of its tasks — and none of them, in which case it is not a row at all.
#
# The one public+done fixture submission is mlp-ts1-baseline, whose eight ts1 entries are all
# TSS and inductive. So a filter naming those keeps it whole, and one naming anything else
# empties it.


async def test_a_task_filter_keeps_the_entries_that_match(seeded_client):
    response = await seeded_client.get(
        LEADERBOARD_URL, params={"training_paradigm": "TSS"}
    )

    [row] = response.json()

    assert len(row["scores"]) == 8


async def test_a_task_filter_drops_the_entries_that_do_not(seeded_client):
    """And with every entry gone the model is not a row: nothing in any column is not a
    competitor."""
    response = await seeded_client.get(
        LEADERBOARD_URL, params={"training_paradigm": "TSU"}
    )

    assert response.json() == []


async def test_several_values_match_any_of_them(seeded_client):
    """A list of values is a question about either, which is what a list of checkboxes asks."""
    response = await seeded_client.get(
        LEADERBOARD_URL, params={"training_paradigm": ["TSS", "TSU"]}
    )

    [row] = response.json()

    assert len(row["scores"]) == 8


async def test_two_filters_both_have_to_hold(seeded_client):
    """Any of the values within one, all of the filters across them."""
    both = await seeded_client.get(
        LEADERBOARD_URL,
        params={"training_paradigm": "TSS", "calibration": "inductive"},
    )

    assert len(both.json()) == 1

    one_fails = await seeded_client.get(
        LEADERBOARD_URL,
        params={"training_paradigm": "TSS", "calibration": "transductive"},
    )

    assert one_fails.json() == []


async def test_an_unanswered_methodology_field_matches_nothing(seeded_client):
    """The fixture's entries record no supervision regime, and an unanswered question is not
    an answer — the same rule the pretrained flag follows."""
    response = await seeded_client.get(
        LEADERBOARD_URL, params={"supervision_regime": "zero_shot"}
    )

    assert response.json() == []


async def test_a_list_field_matches_on_overlap(seeded_client, add):
    """Ticking two modalities asks for entries that used *either*, not both."""
    run = Submission(
        model_id=MODELS["ssl-transformer"],
        label="ssl-extra-input",
        s3_key="submissions/extra.zip",
        status=SubmissionStatus.done,
        is_public=True,
    )
    entry = TaskSubmission(
        submission_id=run.id,
        task_id="ts1-choice",
        extra_input_modality=["behavior"],
    )

    await add(
        run,
        entry,
        TaskScore(task_submission_id=entry.id, n_seeds=3, primary_metric_mean=0.6),
    )

    overlapping = await seeded_client.get(
        LEADERBOARD_URL, params={"extra_input_modality": ["behavior", "anatomy"]}
    )

    assert labels(overlapping) == ["ssl-extra-input"]

    disjoint = await seeded_client.get(
        LEADERBOARD_URL, params={"extra_input_modality": "anatomy"}
    )

    assert disjoint.json() == []


async def test_both_pretrained_values_mean_either_answer(seeded_client, add):
    """Which is a question the flag could not be asked while it took one value.

    Every model that answered, and none that didn't — so it is narrower than no filter at all.
    """
    run = Submission(
        model_id=MODELS["ssl-transformer"],
        label="ssl-pretrained-run",
        s3_key="submissions/ssl.zip",
        status=SubmissionStatus.done,
        is_public=True,
    )
    entry = TaskSubmission(submission_id=run.id, task_id="ts1-choice")

    await add(
        run,
        entry,
        TaskScore(task_submission_id=entry.id, n_seeds=3, primary_metric_mean=0.6),
    )

    response = await seeded_client.get(
        LEADERBOARD_URL, params={"is_pretrained": ["true", "false"]}
    )

    # mlp-baseline answered "no", ssl-transformer answered "yes".
    assert labels(response) == ["mlp-ts1-baseline", "ssl-pretrained-run"]


async def test_a_value_no_enum_has_is_refused(seeded_client):
    """A stale shared link is an error rather than a silently unfiltered board."""
    response = await seeded_client.get(
        LEADERBOARD_URL, params={"training_paradigm": "handwaving"}
    )

    assert response.status_code == 422
