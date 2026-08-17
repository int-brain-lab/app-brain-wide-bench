"""The models router: the directory, its visibility rules, and creating / editing a model.

Visibility is the thing worth testing here. A model is listed publicly because a
*submission* of it is public, so most of these turn on what the caller may see rather
than on the model itself. The caller is a member of nothing until a test says otherwise.
"""

import uuid

from app.models import Model, UserTeam
from tests.conftest import MODEL_ROWS, MODELS, TEAMS

BASELINE = MODELS["mlp-baseline"]
PRETRAINED = MODELS["ssl-transformer"]
UNSUBMITTED = MODELS["unsubmitted-net"]

MY_TEAM = TEAMS["Brain Wide Bench"]
OTHER_TEAM = TEAMS["Int Brain Lab"]


def by_name(response):
    """Return listed models keyed by name."""
    return {row["name"]: row for row in response.json()}


def models_url(model_id=None):
    """The collection, or one model within it."""
    url = "/api/models"

    return url if model_id is None else f"{url}/{model_id}"


async def get_model(client, model_id):
    return await client.get(models_url(model_id))


# ── GET /api/models ───────────────────────────────────────────────────────────


async def test_list_as_non_member(seeded_client):
    """A non-member only sees models with public submissions."""
    response = await seeded_client.get(models_url())

    assert response.status_code == 200

    listed = by_name(response)

    assert set(listed) == {"mlp-baseline"}

    # Only the public submission is visible.
    assert listed["mlp-baseline"]["n_submissions"] == 1
    assert listed["mlp-baseline"]["task_suites"] == ["ts1"]

    # Team information is included in the list response.
    assert listed["mlp-baseline"]["team_name"] == "Brain Wide Bench"


async def test_list_as_member(seeded_client, add, me):
    """A member sees models and submissions belonging to their teams."""
    await add(
        UserTeam(user_id=me, team_id=MY_TEAM),
        UserTeam(user_id=me, team_id=OTHER_TEAM),
    )

    response = await seeded_client.get(models_url())

    assert response.status_code == 200

    listed = by_name(response)

    assert set(listed) == {
        "mlp-baseline",
        "ssl-transformer",
        "unsubmitted-net",
    }

    # Private submissions and their suites are now visible.
    assert listed["mlp-baseline"]["n_submissions"] == 4
    assert listed["mlp-baseline"]["task_suites"] == ["ts1", "ts3"]

    assert listed["ssl-transformer"]["n_submissions"] == 1
    assert listed["ssl-transformer"]["task_suites"] == ["ts2"]

    # Models with no submissions are visible to members of their team.
    assert listed["unsubmitted-net"]["n_submissions"] == 0
    assert listed["unsubmitted-net"]["task_suites"] == []


# ── GET /api/models/{id} ──────────────────────────────────────────────────────


async def test_detail_not_found(seeded_client):
    """An unknown model id returns 404."""
    response = await seeded_client.get(models_url(uuid.uuid4()))

    assert response.status_code == 404


async def test_detail_as_non_member(seeded_client):
    """A non-member only sees public submissions of a model."""
    response = await get_model(seeded_client, BASELINE)

    assert response.status_code == 200

    body = response.json()

    assert body["name"] == "mlp-baseline"
    assert body["team_name"] == "Brain Wide Bench"
    assert [s["label"] for s in body["submissions"]] == [
        "mlp-ts1-baseline"
    ]

    # A model with no public submissions is not visible.
    response = await get_model(seeded_client, UNSUBMITTED)
    assert response.status_code == 404

    # A model whose submissions are all private is not visible.
    response = await get_model(seeded_client, PRETRAINED)
    assert response.status_code == 404


async def test_detail_as_member(seeded_client, add, me):
    """A member sees all submissions belonging to their team."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await get_model(seeded_client, BASELINE)

    assert response.status_code == 200

    body = response.json()

    assert sorted(s["label"] for s in body["submissions"]) == [
        "mlp-ts1-baseline",
        "mlp-ts1-queued",
        "mlp-ts1-rerun",
        "mlp-ts3-internal",
    ]


async def test_detail_embeds_submission_tasks_and_scores(seeded_client):
    """Each submission includes its task submissions and scores."""
    response = await get_model(seeded_client, BASELINE)

    assert response.status_code == 200

    body = response.json()

    tasks = body["submissions"][0]["task_submissions"]

    assert len(tasks) == 8

    reward = next(
        task for task in tasks if task["task_id"] == "ts1-reward"
    )

    assert reward["score"]["primary_metric_mean"] == 0.85
    assert reward["score"]["primary_metric"] == "bacc"


async def test_detail_returns_all_model_fields(seeded_client):
    """The response contains all model fields from the fixture."""
    expected = MODEL_ROWS["mlp-baseline"]

    response = await get_model(seeded_client, BASELINE)

    assert response.status_code == 200

    body = response.json()

    # These are response-only/context fields rather than model columns.
    response_fields = {
        key: value
        for key, value in body.items()
        if key not in {"team_name", "submissions", "created_at"}
    }

    assert response_fields == expected


# ── POST /api/models ──────────────────────────────────────────────────────────


async def test_create_as_non_member(seeded_client):
    """A non-member cannot create a model for a team."""
    response = await seeded_client.post(
        models_url(),
        json={
            "team_id": str(MY_TEAM),
            "name": "new-model",
        },
    )

    assert response.status_code == 403


async def test_create_as_member(seeded_client, add, me):
    """A team member can create a model and receives its detail."""
    await add(
        UserTeam(
            user_id=me,
            team_id=MY_TEAM,
        )
    )

    new_model = {
        "team_id": str(MY_TEAM),
        "name": "new-model",
        "is_pretrained": True,
        "pretrained_in_modalities": ["lfp"],
        "n_parameters": 1000,
    }

    response = await seeded_client.post(
        models_url(),
        json=new_model,
    )

    assert response.status_code == 201, response.text

    body = response.json()

    assert body["name"] == "new-model"
    assert body["team_name"] == "Brain Wide Bench"
    assert body["is_pretrained"] is True
    assert body["pretrained_in_modalities"] == ["lfp"]
    assert body["n_parameters"] == 1000
    assert body["submissions"] == []


async def test_create_rejects_unknown_fields(seeded_client, add, me):
    """Creating a model with unknown fields returns 422."""
    await add(
        UserTeam(
            user_id=me,
            team_id=MY_TEAM,
        )
    )

    response = await seeded_client.post(
        models_url(),
        json={
            "team_id": str(MY_TEAM),
            "name": "new-model",
            "colour": "blue",
        },
    )

    assert response.status_code == 422


async def test_create_rejects_a_name_the_team_already_uses(seeded_client, add, me):
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(
        models_url(), json={"team_id": str(MY_TEAM), "name": "mlp-baseline"}
    )

    assert response.status_code == 409


async def test_create_compares_names_case_insensitively(seeded_client, add, me):
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(
        models_url(), json={"team_id": str(MY_TEAM), "name": "MLP-Baseline"}
    )

    assert response.status_code == 409


async def test_create_allows_another_team_the_same_name(seeded_client, add, me):
    """Names are unique within a team — two labs may each have an "mlp-baseline"."""
    await add(UserTeam(user_id=me, team_id=OTHER_TEAM))

    response = await seeded_client.post(
        models_url(), json={"team_id": str(OTHER_TEAM), "name": "mlp-baseline"}
    )

    assert response.status_code == 201, response.text


async def test_create_rejects_a_blank_name(seeded_client, add, me):
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(models_url(), json={"team_id": str(MY_TEAM), "name": "  "})

    assert response.status_code == 422


# ── PATCH /api/models/{id} ────────────────────────────────────────────────────


async def test_update_rejects_a_name_the_team_already_uses(seeded_client, add, me):
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.patch(
        models_url(BASELINE), json={"name": "ssl-transformer"}
    )

    assert response.status_code == 409


async def test_update_allows_a_model_to_keep_its_own_name(seeded_client, add, me):
    """The check excludes the model being updated, or a no-op PATCH would conflict."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.patch(models_url(BASELINE), json={"name": "mlp-baseline"})

    assert response.status_code == 200, response.text


async def test_update_refuses_a_move_that_collides(seeded_client, add, me):
    """A move alone can conflict: the destination team may already use this name."""
    await add(
        UserTeam(user_id=me, team_id=MY_TEAM),
        UserTeam(user_id=me, team_id=OTHER_TEAM),
        Model(id=uuid.uuid4(), team_id=OTHER_TEAM, name="mlp-baseline"),
    )

    response = await seeded_client.patch(
        models_url(BASELINE), json={"team_id": str(OTHER_TEAM)}
    )

    assert response.status_code == 409


async def test_update_not_found(seeded_client):
    """An unknown model id returns 404."""
    response = await seeded_client.patch(
        models_url(uuid.uuid4()),
        json={"name": "renamed"},
    )

    assert response.status_code == 404


async def test_update_as_non_member(seeded_client):
    """A non-member cannot update a model belonging to a team."""
    response = await get_model(seeded_client, BASELINE)

    assert response.status_code == 200

    response = await seeded_client.patch(
        models_url(BASELINE),
        json={"name": "renamed"},
    )

    assert response.status_code == 403


async def test_update_as_member(seeded_client, add, me):
    """A member can update a model without changing unspecified fields."""
    await add(
        UserTeam(
            user_id=me,
            team_id=MY_TEAM,
        )
    )

    response = await seeded_client.patch(
        models_url(BASELINE),
        json={"name": "renamed"},
    )

    assert response.status_code == 200, response.text

    body = response.json()

    assert body["name"] == "renamed"

    # PATCH is partial: unspecified fields remain unchanged.
    assert body["n_parameters"] == 50000
    assert body["pretrained_in_modalities"] == ["spikes"]


async def test_update_moves_model_to_member_team(
    seeded_client,
    add,
    me,
):
    """A member of two teams can move a model to the other team."""
    await add(
        UserTeam(user_id=me, team_id=MY_TEAM),
        UserTeam(user_id=me, team_id=OTHER_TEAM),
    )

    response = await seeded_client.patch(
        models_url(BASELINE),
        json={"team_id": str(OTHER_TEAM)},
    )

    assert response.status_code == 200, response.text

    body = response.json()

    assert body["team_id"] == str(OTHER_TEAM)
    assert body["team_name"] == "Int Brain Lab"


async def test_update_refuses_non_member_target_team(
    seeded_client,
    add,
    me,
):
    """A member cannot move a model to a team they do not belong to."""
    await add(
        UserTeam(
            user_id=me,
            team_id=MY_TEAM,
        )
    )

    response = await seeded_client.patch(
        models_url(BASELINE),
        json={"team_id": str(OTHER_TEAM)},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Not a member of the target team"


async def test_update_rejects_unknown_fields(seeded_client, add, me):
    """PATCH rejects unknown fields with 422."""
    await add(
        UserTeam(
            user_id=me,
            team_id=MY_TEAM,
        )
    )

    response = await seeded_client.patch(
        models_url(BASELINE),
        json={"colour": "blue"},
    )

    assert response.status_code == 422