"""Tests for the users router.

The main rules are:

- User search is by email, exact, not a prefix or substring. Matching ignores case
  and surrounding whitespace. Display names are not searchable — their owner can set
  them to anything, so matching on one would be a way to be found in someone's place.
- The caller is excluded from search results.
- /me returns and updates the caller's own profile.
- /me/{resource} listings are scoped by team membership. A caller with no
  teams gets an empty list; a team member sees everything belonging to their
  team, including private and pending data.
"""

from app.models import TeamRole, UserTeam
from tests.conftest import TEAMS

BENCHMARK = "benchmark@internationalbrainlab.org"
OUTSIDER = "outsider@cortexlab.org"

MY_TEAM = TEAMS["Brain Wide Bench"]

USERS_URL = "/api/users"
ME_URL = f"{USERS_URL}/me"


def me_url(resource=None):
    """The caller's own record, or one of the listings hanging off it."""
    return ME_URL if resource is None else f"{ME_URL}/{resource}"


def by_name(response):
    return {row["name"]: row for row in response.json()}


def by_label(response):
    return {row["label"]: row for row in response.json()}


def names(response):
    return sorted(row["name"] for row in response.json())


# ── GET /api/users ────────────────────────────────────────────────────────────


async def test_search_by_email(seeded_client):
    """A user can be found by their full email, ignoring case and padding."""

    response = await seeded_client.get(USERS_URL, params={"q": BENCHMARK})
    assert [row["email"] for row in response.json()] == [BENCHMARK]

    response = await seeded_client.get(
        USERS_URL,
        params={"q": f"  {BENCHMARK.upper()} "},
    )
    assert [row["email"] for row in response.json()] == [BENCHMARK]


async def test_search_ignores_names(seeded_client):
    """The name of a fixture user finds nobody: only the email is matched."""

    response = await seeded_client.get(USERS_URL, params={"q": "Brain Wide Bench"})

    assert response.status_code == 200
    assert response.json() == []


async def test_search_is_exact_and_excludes_the_caller(seeded_client, caller):
    """Search does not expose partial matches or the caller themselves."""

    response = await seeded_client.get(USERS_URL, params={"q": "benchmark"})

    assert response.status_code == 200
    assert response.json() == []

    response = await seeded_client.get(
        USERS_URL,
        params={"q": caller["email"]},
    )

    assert response.status_code == 200
    assert response.json() == []


async def test_search_returns_only_picker_fields(seeded_client):
    """Search results contain only the fields needed by a user picker."""

    response = await seeded_client.get(USERS_URL, params={"q": OUTSIDER})

    assert response.status_code == 200
    assert sorted(response.json()[0]) == ["email", "id", "name"]


async def test_search_requires_a_query(seeded_client):
    response = await seeded_client.get(USERS_URL)

    assert response.status_code == 422


# ── GET /api/users/me ─────────────────────────────────────────────────────────


async def test_me_returns_the_callers_profile(seeded_client, caller):
    """The /me endpoint returns the authenticated user's profile."""

    response = await seeded_client.get(me_url())

    assert response.status_code == 200

    body = response.json()

    assert body["id"] == caller["id"]
    assert body["email"] == "dev@brainwidebench.org"
    assert body["provider"] == "google"
    assert body["created_at"] is not None


# ── PATCH /api/users/me ───────────────────────────────────────────────────────


async def test_update_me(seeded_client):
    """The caller can update their profile and PATCH preserves unsent fields."""

    response = await seeded_client.patch(
        me_url(),
        json={
            "name": "Renamed",
            "affiliation": "IBL",
        },
    )

    assert response.status_code == 200, response.text

    body = response.json()

    assert body["name"] == "Renamed"
    assert body["affiliation"] == "IBL"

    # Updating only name must leave affiliation unchanged.
    response = await seeded_client.patch(
        me_url(),
        json={"name": "Another Name"},
    )

    assert response.status_code == 200
    body = response.json()

    assert body["name"] == "Another Name"
    assert body["affiliation"] == "IBL"


async def test_update_me_survives_the_next_request(seeded_client):
    """A rename sticks.

    It used not to: the provider's ``name`` claim was re-applied on every authenticated
    request, so the edit was undone by the very next call. The claim now seeds the row
    once, at first sign-in, and the user owns their display name thereafter.
    """
    await seeded_client.patch(
        me_url(),
        json={"name": "Renamed", "affiliation": "IBL"},
    )

    body = (await seeded_client.get(me_url())).json()

    assert body["name"] == "Renamed"
    assert body["affiliation"] == "IBL"


async def test_update_me_rejects_unknown_fields(seeded_client):
    response = await seeded_client.patch(
        me_url(),
        json={"provider": "orcid"},
    )

    assert response.status_code == 422


# ── GET /api/users/me/models ──────────────────────────────────────────────────


async def test_my_models_as_non_member(seeded_client):
    """A user with no team membership sees no models."""

    response = await seeded_client.get(me_url("models"))

    assert response.status_code == 200
    assert response.json() == []


async def test_my_models_as_member(seeded_client, add, me):
    """A team member sees all models belonging to their team."""

    await add(
        UserTeam(
            user_id=me,
            team_id=MY_TEAM,
        )
    )

    response = await seeded_client.get(me_url("models"))

    assert response.status_code == 200

    listed = by_name(response)

    assert set(listed) == {
        "mlp-baseline",
        "ssl-transformer",
    }

    assert listed["mlp-baseline"]["n_submissions"] == 4
    assert listed["mlp-baseline"]["task_suites"] == ["ts1", "ts3"]
    assert listed["mlp-baseline"]["team_name"] == "Brain Wide Bench"

    assert listed["ssl-transformer"]["n_submissions"] == 1
    assert listed["ssl-transformer"]["team_name"] == "Brain Wide Bench"


# ── GET /api/users/me/submissions ─────────────────────────────────────────────


async def test_my_submissions_as_non_member(seeded_client):
    """A user with no team membership sees no submissions."""

    response = await seeded_client.get(me_url("submissions"))

    assert response.status_code == 200
    assert response.json() == []


async def test_my_submissions_as_member(seeded_client, add, me):
    """A team member sees all submissions from their team, including private ones."""

    await add(
        UserTeam(
            user_id=me,
            team_id=MY_TEAM,
        )
    )

    response = await seeded_client.get(me_url("submissions"))

    assert response.status_code == 200

    listed = by_label(response)

    assert set(listed) == {
        "mlp-ts1-baseline",
        "mlp-ts1-queued",
        "mlp-ts1-rerun",
        "mlp-ts3-internal",
        "ssl-ts2-pilot",
    }

    assert listed["mlp-ts1-baseline"]["task_suites"] == ["ts1"]
    assert listed["mlp-ts1-baseline"]["model_name"] == "mlp-baseline"

    # Queued submissions have tasks but no scores, so no suites are reported.
    assert listed["mlp-ts1-queued"]["task_suites"] == []


# ── GET /api/users/me/teams ───────────────────────────────────────────────────


async def test_my_teams_as_non_member(seeded_client):
    """A user with no team membership sees no teams."""

    response = await seeded_client.get(me_url("teams"))

    assert response.status_code == 200
    assert response.json() == []


async def test_my_teams_as_member(seeded_client, add, me):
    """A team member sees their team, role, and unscoped team counts."""

    await add(
        UserTeam(user_id=me, team_id=MY_TEAM, role=TeamRole.owner)
    )

    response = await seeded_client.get(me_url("teams"))

    assert response.status_code == 200
    assert names(response) == ["Brain Wide Bench"]

    team = response.json()[0]

    assert team["role"] == "owner"
    assert team["n_members"] == 3
    assert team["n_models"] == 2
    assert team["n_submissions"] == 5


async def test_the_me_listings_are_all_mine(seeded_client, add, me):
    """Every row of a ``/me`` listing is the caller's, so ``is_mine`` is always true.

    These endpoints are scoped by membership rather than by visibility — that is the whole
    difference from the public listings — so there is nothing here for it to be false on.
    """
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    for collection in ("models", "submissions", "teams"):
        response = await seeded_client.get(me_url(collection))

        assert response.status_code == 200

        rows = response.json()

        assert rows, f"/me/{collection} returned nothing to check"
        assert all(row["is_mine"] for row in rows), collection


# ── GET /api/users/me/task-submissions ────────────────────────────────────────


async def test_my_task_submissions_as_non_member(seeded_client):
    """A user with no team membership sees no task submissions."""

    response = await seeded_client.get(me_url("task-submissions"))

    assert response.status_code == 200
    assert response.json() == []


async def test_my_task_submissions_as_member(seeded_client, add, me):
    """A team member sees one row for every task in their team's submissions."""

    await add(
        UserTeam(
            user_id=me,
            team_id=MY_TEAM,
        )
    )

    response = await seeded_client.get(me_url("task-submissions"))

    assert response.status_code == 200

    rows = response.json()

    assert len(rows) == 15

    reward = next(
        row
        for row in rows
        if (
            row["task_id"] == "ts1-reward"
            and row["submission_name"] == "mlp-ts1-baseline"
        )
    )

    assert reward["model_name"] == "mlp-baseline"
    assert reward["team_name"] == "Brain Wide Bench"
    assert reward["score"]["primary_metric_mean"] == 0.85
    assert reward["score"]["primary_metric"] == "bacc"


async def test_my_task_submissions_include_unscored_tasks(
    seeded_client,
    add,
    me,
):
    """Unscored tasks are included with a null score."""

    await add(
        UserTeam(
            user_id=me,
            team_id=MY_TEAM,
        )
    )

    rows = (
        await seeded_client.get(me_url("task-submissions"))
    ).json()

    queued = [
        row
        for row in rows
        if row["submission_name"] == "mlp-ts1-queued"
    ]

    assert len(queued) == 2
    assert all(row["score"] is None for row in queued)


async def test_my_task_submissions_include_linking_ids(
    seeded_client,
    add,
    me,
):
    """Each task row contains ids needed to link back to its submission, model and team."""

    await add(
        UserTeam(
            user_id=me,
            team_id=MY_TEAM,
        )
    )

    rows = (
        await seeded_client.get(me_url("task-submissions"))
    ).json()

    assert all(
        row["submission_id"]
        and row["model_id"]
        and row["team_id"]
        for row in rows
    )