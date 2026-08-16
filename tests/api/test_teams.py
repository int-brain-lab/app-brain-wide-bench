"""Tests for the teams router.

The main visibility rules are:

- Everyone can see the team directory.
- Everyone can see member counts, but only team members can see the member list.
- Submission and model counts are based on what the caller can see.
- A team's role is only returned to its members.
- Team members can update the team and manage its membership.
"""

import uuid

from app.models import TeamRole, UserTeam
from tests.conftest import TEAMS, USERS

BENCHMARK = "benchmark@internationalbrainlab.org"
COLLABORATOR = "collaborator@internationalbrainlab.org"
OUTSIDER = "outsider@cortexlab.org"

MY_TEAM = TEAMS["Brain Wide Bench"]
OTHER_TEAM = TEAMS["Int Brain Lab"]
EMPTY_TEAM = TEAMS["Cortex Lab"]


def by_name(response):
    """Return listed teams keyed by name."""
    return {row["name"]: row for row in response.json()}


def member_emails(body):
    """Return a team's member emails in a stable order."""
    return sorted(member["email"] for member in body["members"])


def teams_url(team_id=None):
    """The collection, or one team within it."""
    url = "/api/teams"

    return url if team_id is None else f"{url}/{team_id}"


def members_url(team_id, user_id=None):
    """A team's membership, or one member of it."""
    url = f"{teams_url(team_id)}/members"

    return url if user_id is None else f"{url}/{user_id}"


# ── GET /api/teams ────────────────────────────────────────────────────────────


async def test_list_as_non_member(seeded_client):
    """A non-member can see all teams and only publicly visible counts."""
    response = await seeded_client.get(teams_url())

    assert response.status_code == 200

    listed = by_name(response)

    assert list(listed) == [
        "Brain Wide Bench",
        "Cortex Lab",
        "Int Brain Lab",
    ]

    assert listed["Brain Wide Bench"]["n_members"] == 2
    assert listed["Brain Wide Bench"]["n_submissions"] == 1
    assert listed["Brain Wide Bench"]["n_models"] == 1
    assert listed["Brain Wide Bench"]["role"] is None

    assert listed["Int Brain Lab"]["n_members"] == 1
    assert listed["Int Brain Lab"]["n_submissions"] == 0
    assert listed["Int Brain Lab"]["n_models"] == 0
    assert listed["Int Brain Lab"]["role"] is None

    assert listed["Cortex Lab"]["n_members"] == 1
    assert listed["Cortex Lab"]["n_submissions"] == 0
    assert listed["Cortex Lab"]["n_models"] == 0
    assert listed["Cortex Lab"]["role"] is None


async def test_list_as_member(seeded_client, add, me):
    """A member sees all counts for their team and their own role."""
    await add(
        UserTeam(
            user_id=me,
            team_id=MY_TEAM,
            role=TeamRole.collaborator,
        )
    )

    response = await seeded_client.get(teams_url())

    assert response.status_code == 200

    listed = by_name(response)

    # Own team: private content is included.
    assert listed["Brain Wide Bench"]["n_members"] == 3 # original 2 members plus caller
    assert listed["Brain Wide Bench"]["n_submissions"] == 5
    assert listed["Brain Wide Bench"]["n_models"] == 2
    assert listed["Brain Wide Bench"]["role"] == "collaborator"

    # Other teams: only public information is visible.
    assert listed["Int Brain Lab"]["n_submissions"] == 0
    assert listed["Int Brain Lab"]["n_models"] == 0
    assert listed["Int Brain Lab"]["role"] is None

    assert listed["Cortex Lab"]["n_submissions"] == 0
    assert listed["Cortex Lab"]["n_models"] == 0
    assert listed["Cortex Lab"]["role"] is None


# ── GET /api/teams/{id} ───────────────────────────────────────────────────────


async def test_detail_not_found(seeded_client):
    """An unknown team id returns 404."""
    response = await seeded_client.get(
        teams_url(uuid.uuid4())
    )

    assert response.status_code == 404


async def test_detail_as_non_member(seeded_client):
    """A non-member sees public counts but not the member list or role."""
    response = await seeded_client.get(
        teams_url(MY_TEAM)
    )

    assert response.status_code == 200

    body = response.json()

    assert body["n_members"] == 2
    assert body["n_submissions"] == 1
    assert body["n_models"] == 1
    assert body["members"] is None
    assert body["role"] is None


async def test_detail_as_member(seeded_client, add, me, caller):
    """A member sees all counts, their role, and the member list."""
    await add(
        UserTeam(
            user_id=me,
            team_id=MY_TEAM,
            role=TeamRole.owner,
        )
    )

    response = await seeded_client.get(
        teams_url(MY_TEAM)
    )

    assert response.status_code == 200

    body = response.json()

    assert body["n_members"] == 3 # original 2 members plus caller
    assert body["n_submissions"] == 5
    assert body["n_models"] == 2
    assert body["role"] == "owner"

    roles = {
        member["email"]: member["role"]
        for member in body["members"]
    }
    assert roles == {
        BENCHMARK: "owner",
        COLLABORATOR: "collaborator",
        caller["email"]: "owner",
    }


# ── POST /api/teams ──────────────────────────────────────────────────────────


async def test_create(seeded_client, caller):
    """A user can create a team and is automatically made its owner."""
    response = await seeded_client.post(
        teams_url(),
        json={"name": "New Lab"},
    )

    assert response.status_code == 201, response.text

    body = response.json()

    assert body["name"] == "New Lab"
    assert body["n_members"] == 1
    assert member_emails(body) == [caller["email"]]
    assert body["role"] == "owner"


async def test_create_trims_the_name(seeded_client):
    """Whitespace is stripped from a team name."""
    response = await seeded_client.post(
        teams_url(),
        json={"name": "  New Lab  "},
    )

    assert response.status_code == 201, response.text
    assert response.json()["name"] == "New Lab"


async def test_create_rejects_invalid_name(seeded_client):
    """A blank team name is rejected."""
    response = await seeded_client.post(
        teams_url(),
        json={"name": "   "},
    )

    assert response.status_code == 422


async def test_create_rejects_duplicate_name(seeded_client):
    """Team names must be unique, case-insensitively."""
    for name in ("Brain Wide Bench", "brain wide bench"):
        response = await seeded_client.post(
            teams_url(),
            json={"name": name},
        )

        assert response.status_code == 409


async def test_create_rejects_unknown_fields(seeded_client):
    """Every other request body forbids extras; this one used to accept them silently."""
    response = await seeded_client.post(teams_url(), json={"name": "New Lab", "role": "owner"})

    assert response.status_code == 422


# ── PATCH /api/teams/{id} ─────────────────────────────────────────────────────


async def test_update_not_found(seeded_client):
    """An unknown team id returns 404."""
    response = await seeded_client.patch(
        teams_url(uuid.uuid4()),
        json={"name": "Renamed Lab"},
    )

    assert response.status_code == 404


async def test_update_as_non_member(seeded_client):
    """A non-member cannot update a team."""
    response = await seeded_client.patch(
        teams_url(MY_TEAM),
        json={"name": "Renamed Lab"},
    )

    assert response.status_code == 403


async def test_update_as_member(seeded_client, add, me):
    """A member can rename their team."""
    await add(
        UserTeam(
            user_id=me,
            team_id=MY_TEAM,
        )
    )

    response = await seeded_client.patch(
        teams_url(MY_TEAM),
        json={"name": "Renamed Lab"},
    )

    assert response.status_code == 200, response.text
    assert response.json()["name"] == "Renamed Lab"


async def test_update_rejects_duplicate_name(seeded_client, add, me):
    """A team cannot be renamed to another team's name."""
    await add(
        UserTeam(
            user_id=me,
            team_id=MY_TEAM,
        )
    )

    response = await seeded_client.patch(
        teams_url(MY_TEAM),
        json={"name": "Cortex Lab"},
    )

    assert response.status_code == 409


async def test_update_allows_existing_name(seeded_client, add, me):
    """A team can be patched with its existing name."""
    await add(
        UserTeam(
            user_id=me,
            team_id=MY_TEAM,
        )
    )

    response = await seeded_client.patch(
        teams_url(MY_TEAM),
        json={"name": "Brain Wide Bench"},
    )

    assert response.status_code == 200, response.text


async def test_update_rejects_unknown_fields(seeded_client, add, me):
    """Unknown fields are rejected."""
    await add(
        UserTeam(
            user_id=me,
            team_id=MY_TEAM,
        )
    )

    response = await seeded_client.patch(
        teams_url(MY_TEAM),
        json={"colour": "blue"},
    )

    assert response.status_code == 422


# ── POST /api/teams/{id}/members ──────────────────────────────────────────────


async def test_add_member_as_non_member(seeded_client):
    """A non-member cannot add members to a team."""
    response = await seeded_client.post(
        members_url(MY_TEAM),
        json={"email": OUTSIDER},
    )

    assert response.status_code == 403


async def test_add_member_as_member(seeded_client, add, me):
    """A member can add another user to the team."""
    await add(
        UserTeam(
            user_id=me,
            team_id=MY_TEAM,
        )
    )

    response = await seeded_client.post(
        members_url(MY_TEAM),
        json={"email": OUTSIDER},
    )

    assert response.status_code == 201, response.text

    body = response.json()

    assert body["email"] == OUTSIDER
    assert body["id"] == str(USERS[OUTSIDER])

    team = (
        await seeded_client.get(
            teams_url(MY_TEAM)
        )
    ).json()

    assert OUTSIDER in member_emails(team)
    assert team["n_members"] == 4


async def test_add_member_unknown_email(seeded_client, add, me):
    """An unregistered user cannot be added to a team."""
    await add(
        UserTeam(
            user_id=me,
            team_id=MY_TEAM,
        )
    )

    response = await seeded_client.post(
        members_url(MY_TEAM),
        json={"email": "nobody@example.org"},
    )

    assert response.status_code == 404


async def test_add_member_already_in_team(seeded_client, add, me):
    """A user cannot be added to a team they already belong to."""
    await add(
        UserTeam(
            user_id=me,
            team_id=MY_TEAM,
        )
    )

    response = await seeded_client.post(
        members_url(MY_TEAM),
        json={"email": COLLABORATOR},
    )

    assert response.status_code == 409


# ── DELETE /api/teams/{id}/members/{user_id} ──────────────────────────────────

async def test_remove_member_as_non_member(seeded_client):
    """A non-member cannot remove members from a team."""
    response = await seeded_client.delete(
        members_url(MY_TEAM, USERS[COLLABORATOR])
    )

    assert response.status_code == 403

async def test_remove_member(seeded_client, add, me):
    """A member can remove another member from the team."""
    await add(
        UserTeam(
            user_id=me,
            team_id=MY_TEAM,
        )
    )

    response = await seeded_client.delete(
        members_url(MY_TEAM, USERS[COLLABORATOR])
    )

    assert response.status_code == 204

    team = (
        await seeded_client.get(
            teams_url(MY_TEAM)
        )
    ).json()

    assert COLLABORATOR not in member_emails(team)


async def test_remove_member_not_in_team(seeded_client, add, me):
    """Removing a user who is not a team member returns 404."""
    await add(
        UserTeam(
            user_id=me,
            team_id=MY_TEAM,
        )
    )

    response = await seeded_client.delete(
        members_url(MY_TEAM, USERS[OUTSIDER])
    )

    assert response.status_code == 404


async def test_remove_last_member_is_refused(seeded_client, me):
    """The last member cannot be removed from a team."""
    team = (
        await seeded_client.post(
            teams_url(),
            json={"name": "Solo Lab"},
        )
    ).json()

    response = await seeded_client.delete(
        members_url(team["id"], me)
    )

    assert response.status_code == 409

