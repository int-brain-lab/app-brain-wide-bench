"""Tests for the task submissions router.

The main rules are:

- Reading follows the parent submission: public tasks are public, private tasks are
  visible only to members of the submission's team.
- A task submission is only reachable through its own submission. An id belonging to
  another submission returns 404.
- Updates require membership of the submission's team.
- Updates are partial: omitted fields keep their existing values.
- Bulk updates are atomic: if any task id is invalid, nothing is changed.
"""

import uuid

from app.models import UserTeam
from tests.conftest import SUBMISSIONS, TASK_SUBMISSIONS, TEAMS

BASELINE = SUBMISSIONS["mlp-ts1-baseline"]
QUEUED = SUBMISSIONS["mlp-ts1-queued"]

REWARD = TASK_SUBMISSIONS["mlp-ts1-baseline"]["ts1-reward"]
CHOICE = TASK_SUBMISSIONS["mlp-ts1-baseline"]["ts1-choice"]
UNSCORED = TASK_SUBMISSIONS["mlp-ts1-queued"]["ts1-wheel_speed"]

MY_TEAM = TEAMS["Brain Wide Bench"]


def tasks_url(submission_id, task_submission_id=None):
    """Build a task-submission endpoint URL."""
    url = f"/api/submissions/{submission_id}/tasks"

    if task_submission_id is not None:
        url += f"/{task_submission_id}"

    return url


# ── GET /api/submissions/{id}/tasks/{task_submission_id} ──────────────────────


async def test_detail_not_found(seeded_client):
    """An unknown task submission id returns 404."""
    response = await seeded_client.get(
        tasks_url(BASELINE, uuid.uuid4())
    )

    assert response.status_code == 404


async def test_detail_as_non_member(seeded_client):
    """A non-member can read tasks from a public submission but not a private one."""
    response = await seeded_client.get(
        tasks_url(BASELINE, REWARD)
    )

    assert response.status_code == 200

    body = response.json()

    assert body["task_id"] == "ts1-reward"
    assert body["score"]["primary_metric_mean"] == 0.85

    response = await seeded_client.get(
        tasks_url(QUEUED, UNSCORED)
    )

    assert response.status_code == 403


async def test_detail_as_member(seeded_client, add, me):
    """A team member can read tasks and their scores, including unscored tasks."""
    await add(
        UserTeam(
            user_id=me,
            team_id=TEAMS["Brain Wide Bench"],
        )
    )

    response = await seeded_client.get(
        tasks_url(BASELINE, REWARD)
    )

    assert response.status_code == 200

    body = response.json()

    assert body["id"] == str(REWARD)
    assert body["task_id"] == "ts1-reward"
    assert body["training_paradigm"] == "TSS"
    assert body["calibration"] == "inductive"

    assert body["score"]["n_seeds"] == 5
    assert body["score"]["primary_metric_mean"] == 0.85
    assert body["score"]["primary_metric"] == "bacc"

    # Pending tasks are visible, but do not have a score yet.
    response = await seeded_client.get(
        tasks_url(QUEUED, UNSCORED)
    )

    assert response.status_code == 200
    assert response.json()["score"] is None


async def test_detail_rejects_a_task_from_another_submission(
    seeded_client,
    add,
    me,
):
    """A valid task id from another submission returns 404."""
    await add(
        UserTeam(
            user_id=me,
            team_id=TEAMS["Brain Wide Bench"],
        )
    )

    response = await seeded_client.get(
        tasks_url(QUEUED, REWARD)
    )

    assert response.status_code == 404


# ── PATCH /api/submissions/{id}/tasks/{task_submission_id} ────────────────────


async def test_update_not_found(seeded_client, add, me):
    """An unknown task submission id returns 404."""
    await add(
        UserTeam(
            user_id=me,
            team_id=TEAMS["Brain Wide Bench"],
        )
    )

    response = await seeded_client.patch(
        tasks_url(BASELINE, uuid.uuid4()),
        json={"calibration": "transductive"},
    )

    assert response.status_code == 404


async def test_update_as_non_member(seeded_client):
    """A non-member cannot update a task submission."""
    response = await seeded_client.patch(
        tasks_url(BASELINE, REWARD),
        json={"calibration": "transductive"},
    )

    assert response.status_code == 403


async def test_update_as_member(seeded_client, add, me):
    """A member can update a task submission and omitted fields are preserved."""
    await add(
        UserTeam(
            user_id=me,
            team_id=TEAMS["Brain Wide Bench"],
        )
    )

    response = await seeded_client.patch(
        tasks_url(BASELINE, REWARD),
        json={
            "calibration": "transductive",
            "supervision_regime": "few_shot",
            "extra_input_modality": ["lfp", "behavior"],
            "finetuning_strategy": ["linear_probe"],
        },
    )

    assert response.status_code == 200, response.text

    body = response.json()

    assert body["calibration"] == "transductive"
    assert body["supervision_regime"] == "few_shot"
    assert body["extra_input_modality"] == ["lfp", "behavior"]
    assert body["finetuning_strategy"] == ["linear_probe"]

    # PATCH is partial.
    assert body["training_paradigm"] == "TSS"


async def test_update_rejects_invalid_fields(seeded_client, add, me):
    """Unknown fields and invalid enum values are rejected."""
    await add(
        UserTeam(
            user_id=me,
            team_id=TEAMS["Brain Wide Bench"],
        )
    )

    response = await seeded_client.patch(
        tasks_url(BASELINE, REWARD),
        json={"seeds": 3},
    )

    assert response.status_code == 422

    response = await seeded_client.patch(
        tasks_url(BASELINE, REWARD),
        json={"calibration": "sideways"},
    )

    assert response.status_code == 422


# ── PATCH /api/submissions/{id}/tasks ─────────────────────────────────────────


async def test_bulk_update_as_non_member(seeded_client):
    """A non-member cannot bulk update task submissions."""
    response = await seeded_client.patch(
        tasks_url(BASELINE),
        json={
            "task_submission_ids": [str(REWARD), str(CHOICE)],
            "updates": {"calibration": "transductive"},
        },
    )

    assert response.status_code == 403


async def test_bulk_update_as_member(seeded_client, add, me):
    """A member can update multiple tasks and the response is returned in task order."""
    await add(
        UserTeam(
            user_id=me,
            team_id=TEAMS["Brain Wide Bench"],
        )
    )

    response = await seeded_client.patch(
        tasks_url(BASELINE),
        json={
            "task_submission_ids": [str(REWARD), str(CHOICE)],
            "updates": {"calibration": "transductive"},
        },
    )

    assert response.status_code == 200, response.text

    body = response.json()

    assert [row["task_id"] for row in body] == [
        "ts1-choice",
        "ts1-reward",
    ]

    assert {
        row["task_id"]: row["calibration"]
        for row in body
    } == {
        "ts1-choice": "transductive",
        "ts1-reward": "transductive",
    }


async def test_bulk_update_is_atomic(seeded_client, add, me):
    """A task from another submission causes the whole bulk update to fail."""
    await add(
        UserTeam(
            user_id=me,
            team_id=TEAMS["Brain Wide Bench"],
        )
    )

    response = await seeded_client.patch(
        tasks_url(BASELINE),
        json={
            "task_submission_ids": [str(REWARD), str(UNSCORED)],
            "updates": {"calibration": "transductive"},
        },
    )

    assert response.status_code == 404

    # The valid task must remain unchanged.
    response = await seeded_client.get(
        tasks_url(BASELINE, REWARD)
    )

    assert response.status_code == 200
    assert response.json()["calibration"] == "inductive"


async def test_bulk_update_requires_at_least_one_task(
    seeded_client,
    add,
    me,
):
    """A bulk update must contain at least one task submission id."""
    await add(
        UserTeam(
            user_id=me,
            team_id=TEAMS["Brain Wide Bench"],
        )
    )

    response = await seeded_client.patch(
        tasks_url(BASELINE),
        json={
            "task_submission_ids": [],
            "updates": {"calibration": "transductive"},
        },
    )

    assert response.status_code == 422