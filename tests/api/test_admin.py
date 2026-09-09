"""Tests for the ``admin`` role.

The main rules are:

- An admin passes every team membership and ownership check without joining a team.
- An admin sees every model and submission, private ones included.
- An admin is given the fields withheld from an outsider: a submission's
  ``narrative_private`` and ``s3_key``, and a team's member list.
- An admin can write to another team's records and manage its membership.
- ``can_manage_members`` is granted without a role, which ``role`` cannot express.
- ``/api/users/me/*`` still answers "what is mine", not "everything".
- The role cannot be granted through the API.
- Every one of these is refused for a plain user, who is what the caller is by default.
"""

import pytest_asyncio

from app.models import User, UserRole
from tests.conftest import MODELS, SUBMISSIONS, TEAMS, USERS

COLLABORATOR = "collaborator@internationalbrainlab.org"
OUTSIDER = "outsider@cortexlab.org"

EMPTY_TEAM = TEAMS["Cortex Lab"]

PRIVATE = SUBMISSIONS["mlp-ts1-rerun"]
PUBLIC = SUBMISSIONS["mlp-ts1-baseline"]
UNSUBMITTED_MODEL = MODELS["unsubmitted-net"]

# Five submissions across the fixture, one of them public; three models, one of which has a
# public submission. So "everything" and "what an outsider sees" are different numbers.
ALL_SUBMISSIONS = 5
ALL_MODELS = 3


@pytest_asyncio.fixture
async def admin(me, session_factory):
    """Promote the caller to ``admin``.

    The caller rather than a fixture row: dev mode authenticates every request as the stub
    user, so a seeded admin could be acted *on* but never acted *as*. They belong to no
    team, which is what makes each pass below a real bypass rather than membership.
    """
    async with session_factory() as session:
        user = await session.get(User, me)
        user.role = UserRole.admin
        await session.commit()

    return me


def labels(response):
    """Return the labels of a submission listing."""
    return sorted(row["label"] for row in response.json())


# ── GET /api/users/me ─────────────────────────────────────────────────────────


async def test_me_reports_admin(seeded_client, admin):
    """A promoted caller reads back as an admin.

    The plain-``user`` default is asserted by ``test_me_returns_the_callers_profile``.
    """
    response = await seeded_client.get("/api/users/me")

    assert response.status_code == 200
    assert response.json()["role"] == "admin"


async def test_patch_me_cannot_grant_the_role(seeded_client, session_factory, me):
    """The role is not settable through the API, so a token can never escalate itself."""
    response = await seeded_client.patch("/api/users/me", json={"role": "admin"})

    assert response.status_code == 422

    async with session_factory() as session:
        assert (await session.get(User, me)).role is UserRole.user


# ── GET /api/submissions ──────────────────────────────────────────────────────


async def test_list_submissions_as_admin(seeded_client, admin):
    """An admin's listing is every submission, not only the published one."""
    response = await seeded_client.get("/api/submissions")

    assert response.status_code == 200
    assert len(response.json()) == ALL_SUBMISSIONS
    assert "mlp-ts1-rerun" in labels(response)


async def test_list_submissions_as_user(seeded_client, caller):
    """A plain non-member sees only the published submission."""
    response = await seeded_client.get("/api/submissions")

    assert response.status_code == 200
    assert labels(response) == ["mlp-ts1-baseline"]


# ── GET /api/submissions/{id} ─────────────────────────────────────────────────


async def test_detail_as_admin(seeded_client, admin):
    """An admin reads a private submission in full, including the withheld fields."""
    response = await seeded_client.get(f"/api/submissions/{PRIVATE}")

    assert response.status_code == 200
    body = response.json()
    assert body["label"] == "mlp-ts1-rerun"
    assert body["narrative_private"] == "Seed sweep, not for release."
    assert body["s3_key"]
    assert body["is_mine"] is True


async def test_detail_as_user(seeded_client, caller):
    """A non-member is refused a private submission and redacted on a public one."""
    private = await seeded_client.get(f"/api/submissions/{PRIVATE}")

    assert private.status_code == 403

    public = await seeded_client.get(f"/api/submissions/{PUBLIC}")

    assert public.status_code == 200
    assert public.json()["narrative_private"] is None
    assert public.json()["s3_key"] is None
    assert public.json()["is_mine"] is False


# ── PATCH /api/submissions/{id} ───────────────────────────────────────────────


async def test_patch_submission_as_admin(seeded_client, admin):
    """An admin can write to another team's submission."""
    response = await seeded_client.patch(
        f"/api/submissions/{PRIVATE}", json={"narrative_public": "Reviewed by an admin."}
    )

    assert response.status_code == 200
    assert response.json()["narrative_public"] == "Reviewed by an admin."


async def test_patch_submission_as_user(seeded_client, caller):
    """A non-member cannot write to it."""
    response = await seeded_client.patch(
        f"/api/submissions/{PRIVATE}", json={"narrative_public": "Not mine to edit."}
    )

    assert response.status_code == 403


# ── GET /api/models ───────────────────────────────────────────────────────────


async def test_list_models_as_admin(seeded_client, admin):
    """An admin sees every model, including one nobody has submitted to."""
    response = await seeded_client.get("/api/models")

    assert response.status_code == 200
    assert len(response.json()) == ALL_MODELS
    assert "unsubmitted-net" in {row["name"] for row in response.json()}


async def test_list_models_as_user(seeded_client, caller):
    """A non-member sees only models with a published submission."""
    response = await seeded_client.get("/api/models")

    assert response.status_code == 200
    assert {row["name"] for row in response.json()} == {"mlp-baseline"}


async def test_model_detail_as_admin(seeded_client, admin):
    """A model with nothing public 404s for an outsider and opens for an admin."""
    response = await seeded_client.get(f"/api/models/{UNSUBMITTED_MODEL}")

    assert response.status_code == 200
    assert response.json()["name"] == "unsubmitted-net"


async def test_model_detail_as_user(seeded_client, caller):
    """A non-member gets 404, not 403 — the model is not theirs to know about."""
    response = await seeded_client.get(f"/api/models/{UNSUBMITTED_MODEL}")

    assert response.status_code == 404


# ── GET /api/teams ────────────────────────────────────────────────────────────


async def test_list_teams_as_admin(seeded_client, admin):
    """The directory marks every team manageable without granting a role in any."""
    response = await seeded_client.get("/api/teams")

    assert response.status_code == 200

    listed = response.json()

    assert len(listed) == 3
    assert all(row["is_mine"] for row in listed)
    assert all(row["can_manage_members"] for row in listed)
    assert all(row["role"] is None for row in listed)


# ── GET /api/teams/{id} ───────────────────────────────────────────────────────


async def test_team_detail_as_admin(seeded_client, admin):
    """An admin is given a team's member list and may manage it, holding no role in it."""
    response = await seeded_client.get(f"/api/teams/{EMPTY_TEAM}")

    assert response.status_code == 200
    body = response.json()
    assert [member["email"] for member in body["members"]] == [OUTSIDER]
    assert body["is_mine"] is True
    assert body["can_manage_members"] is True
    # Truthful: the bypass grants access, it does not invent a membership.
    assert body["role"] is None


async def test_team_detail_as_user(seeded_client, caller):
    """A non-member is told the member list exists but not what is in it."""
    response = await seeded_client.get(f"/api/teams/{EMPTY_TEAM}")

    assert response.status_code == 200
    assert response.json()["members"] is None
    assert response.json()["is_mine"] is False
    assert response.json()["can_manage_members"] is False


# ── POST/DELETE /api/teams/{id}/members ───────────────────────────────────────


async def test_manage_members_as_admin(seeded_client, admin):
    """An admin can add and remove members on a team they do not own."""
    added = await seeded_client.post(
        f"/api/teams/{EMPTY_TEAM}/members", json={"email": COLLABORATOR}
    )

    assert added.status_code == 201
    assert added.json()["role"] == "collaborator"

    removed = await seeded_client.delete(
        f"/api/teams/{EMPTY_TEAM}/members/{USERS[COLLABORATOR]}"
    )

    assert removed.status_code == 204


async def test_manage_members_as_user(seeded_client, caller):
    """A non-owner cannot."""
    response = await seeded_client.post(
        f"/api/teams/{EMPTY_TEAM}/members", json={"email": COLLABORATOR}
    )

    assert response.status_code == 403


# ── GET /api/users/me/* ───────────────────────────────────────────────────────


async def test_my_dashboards_stay_personal(seeded_client, admin):
    """An admin's own dashboards are still their own work, not the whole database."""
    for path in ("submissions", "models", "teams", "task-submissions"):
        response = await seeded_client.get(f"/api/users/me/{path}")

        assert response.status_code == 200, path
        assert response.json() == [], path
