"""Tests for the submissions router.

The main rules are:

- Listing and reading follow visibility: a public submission is visible to everyone;
  a private submission is visible only to members of its team.
- Public submissions hide team-only fields such as ``s3_key`` and ``narrative_private``.
- Creating, submitting and editing are member-only.
- A submission's team follows its model; callers cannot choose it directly.
- Moving a submission to another team's model requires membership of the destination team.
"""

import uuid

from app.models import UserTeam
from tests.conftest import MODELS, SUBMISSIONS, TEAMS

PUBLIC = SUBMISSIONS["mlp-ts1-baseline"]
PRIVATE = SUBMISSIONS["mlp-ts1-rerun"]

BASELINE = MODELS["mlp-baseline"]
OTHER_TEAM_MODEL = MODELS["unsubmitted-net"]

MY_TEAM = TEAMS["Brain Wide Bench"]
OTHER_TEAM = TEAMS["Int Brain Lab"]


def presign_body(**overrides):
    """Return the minimal valid presign request."""
    return {
        "model_id": str(BASELINE),
        "label": "new-run",
        "is_public": False,
        "tasks": [{"task_id": "ts1-reward"}],
        **overrides,
    }


def labels(response):
    """Return submission labels in a stable order."""
    return sorted(row["label"] for row in response.json())


def submissions_url(submission_id=None):
    """The collection, or one submission within it."""
    url = "/api/submissions"

    return url if submission_id is None else f"{url}/{submission_id}"


def presign_url():
    """Where a submission is created — the collection has no plain POST."""
    return f"{submissions_url()}/presign"


def submit_url(submission_id):
    return f"{submissions_url(submission_id)}/submit"


# ── POST /api/submissions/presign ─────────────────────────────────────────────


async def test_presign_as_non_member(seeded_client):
    """A non-member cannot create a submission."""
    response = await seeded_client.post(
        presign_url(),
        json=presign_body(),
    )

    assert response.status_code == 403


async def test_presign_as_member(seeded_client, add, me):
    """A member can create a submission and receives upload information."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(
        presign_url(),
        json=presign_body(),
    )

    assert response.status_code == 200, response.text

    body = response.json()

    assert body["submission_id"] in body["s3_key"]
    assert body["upload_url"]

    created = (
        await seeded_client.get(submissions_url(body["submission_id"]))
    ).json()

    assert created["label"] == "new-run"
    assert created["team_id"] == str(MY_TEAM)
    assert [task["task_id"] for task in created["task_submissions"]] == [
        "ts1-reward"
    ]


async def test_presign_slugifies_the_label_into_the_key(seeded_client, add, me):
    """Unsafe path characters in the label cannot escape the submission directory."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(
        presign_url(),
        json=presign_body(label="../etc/passwd"),
    )

    assert response.status_code == 200

    body = response.json()

    assert body["s3_key"] == (
        f"submissions/{body['submission_id']}/etc-passwd.zip"
    )


async def test_presign_unknown_model(seeded_client, add, me):
    """A submission cannot be created for a model that does not exist."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(
        presign_url(),
        json=presign_body(model_id=str(uuid.uuid4())),
    )

    assert response.status_code == 404


async def test_presign_unknown_task(seeded_client, add, me):
    """Every requested task must exist."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(
        presign_url(),
        json=presign_body(
            tasks=[{"task_id": "ts9-nonsense"}],
        ),
    )

    assert response.status_code == 400


async def test_presign_rejects_duplicate_tasks(seeded_client, add, me):
    """A task can appear only once in a submission."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(
        presign_url(),
        json=presign_body(
            tasks=[
                {"task_id": "ts1-reward"},
                {"task_id": "ts1-reward"},
            ],
        ),
    )

    assert response.status_code == 400


async def test_presign_rejects_unknown_fields(seeded_client, add, me):
    """The team is inferred from the model and cannot be supplied by the caller."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(
        presign_url(),
        json=presign_body(team_id=str(MY_TEAM)),
    )

    assert response.status_code == 422


# ── POST /api/submissions/{id}/submit ──────────────────────────────────────────


async def test_submit_as_non_member(seeded_client):
    """A non-member cannot submit a submission."""
    response = await seeded_client.post(submit_url(PUBLIC))

    assert response.status_code == 403


async def test_submit_as_member(seeded_client, add, me):
    """A team member can submit a submission for scoring."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(submit_url(PUBLIC))

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "scoring"


async def test_submit_not_found(seeded_client, add, me):
    """Submitting an unknown submission returns 404."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(submit_url(uuid.uuid4()))

    assert response.status_code == 404


# ── GET /api/submissions ──────────────────────────────────────────────────────


async def test_list_as_non_member(seeded_client):
    """A non-member sees only public submissions."""
    response = await seeded_client.get(submissions_url())

    assert response.status_code == 200
    assert labels(response) == ["mlp-ts1-baseline"]


async def test_list_as_member(seeded_client, add, me):
    """A member sees all submissions belonging to their team."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.get(submissions_url())

    assert response.status_code == 200
    assert labels(response) == [
        "mlp-ts1-baseline",
        "mlp-ts1-queued",
        "mlp-ts1-rerun",
        "mlp-ts3-internal",
        "ssl-ts2-pilot",
    ]


async def test_list_includes_submission_summary(seeded_client):
    """The list response includes the model, team and scored task-suite summary."""
    listed = {
        row["label"]: row
        for row in (await seeded_client.get(submissions_url())).json()
    }

    submission = listed["mlp-ts1-baseline"]

    assert submission["task_suites"] == ["ts1"]
    assert submission["model_name"] == "mlp-baseline"
    assert submission["team_name"] == "Brain Wide Bench"


# ── GET /api/submissions/{id} ─────────────────────────────────────────────────


async def test_detail_as_non_member(seeded_client):
    """A non-member can read a public submission but not its team-only fields."""
    response = await seeded_client.get(submissions_url(PUBLIC))

    assert response.status_code == 200

    body = response.json()

    assert body["label"] == "mlp-ts1-baseline"
    assert body["narrative_public"] is not None
    assert len(body["task_submissions"]) == 8

    assert body["s3_key"] is None
    assert body["narrative_private"] is None


async def test_detail_private_submission_is_hidden_from_non_member(seeded_client):
    """A private submission cannot be read by a non-member."""
    response = await seeded_client.get(submissions_url(PRIVATE))

    assert response.status_code == 403


async def test_detail_as_member(seeded_client, add, me):
    """A team member can see private submissions and their team-only fields."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.get(submissions_url(PRIVATE))

    assert response.status_code == 200

    body = response.json()

    assert body["label"] == "mlp-ts1-rerun"
    assert body["s3_key"] is not None
    assert body["narrative_private"] == "Seed sweep, not for release."
    assert body["model"]["name"] == "mlp-baseline"


async def test_detail_not_found(seeded_client):
    """An unknown submission id returns 404."""
    response = await seeded_client.get(submissions_url(uuid.uuid4()))

    assert response.status_code == 404


# ── PATCH /api/submissions/{id} ───────────────────────────────────────────────


async def test_update_as_non_member(seeded_client):
    """A non-member cannot update a submission."""
    response = await seeded_client.patch(
        submissions_url(PUBLIC),
        json={"label": "renamed"},
    )

    assert response.status_code == 403


async def test_update_as_member(seeded_client, add, me):
    """A member can update editable fields without changing unsent fields."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.patch(
        submissions_url(PUBLIC),
        json={
            "label": "renamed",
            "is_public": False,
            "narrative_private": "wip",
        },
    )

    assert response.status_code == 200, response.text

    body = response.json()

    assert body["label"] == "renamed"
    assert body["is_public"] is False
    assert body["narrative_private"] == "wip"

    # Unsent fields are unchanged.
    assert body["narrative_public"] is not None
    assert body["model_id"] == str(BASELINE)


async def test_update_moves_the_submission_with_the_model(
    seeded_client,
    add,
    me,
):
    """Changing the model also changes the submission's team."""
    await add(
        UserTeam(user_id=me, team_id=MY_TEAM),
        UserTeam(user_id=me, team_id=OTHER_TEAM),
    )

    response = await seeded_client.patch(
        submissions_url(PUBLIC),
        json={"model_id": str(OTHER_TEAM_MODEL)},
    )

    assert response.status_code == 200, response.text

    body = response.json()

    assert body["model_id"] == str(OTHER_TEAM_MODEL)
    assert body["team_id"] == str(OTHER_TEAM)
    assert body["team_name"] == "Int Brain Lab"
    assert body["model_name"] == "unsubmitted-net"


async def test_update_requires_membership_of_target_model_team(
    seeded_client,
    add,
    me,
):
    """Moving a submission requires membership of the destination team."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.patch(
        submissions_url(PUBLIC),
        json={"model_id": str(OTHER_TEAM_MODEL)},
    )

    assert response.status_code == 403


async def test_update_unknown_model(seeded_client, add, me):
    """A submission cannot be moved to a model that does not exist."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.patch(
        submissions_url(PUBLIC),
        json={"model_id": str(uuid.uuid4())},
    )

    assert response.status_code == 404


async def test_update_not_found(seeded_client, add, me):
    """Updating an unknown submission returns 404."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.patch(
        submissions_url(uuid.uuid4()),
        json={"label": "renamed"},
    )

    assert response.status_code == 404


async def test_update_rejects_unknown_fields(seeded_client, add, me):
    """Server-managed fields cannot be updated by the caller."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.patch(
        submissions_url(PUBLIC),
        json={"status": "done"},
    )

    assert response.status_code == 422