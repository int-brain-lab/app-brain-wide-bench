"""In-process API tests (no containers)."""

import uuid


from app.models import (
    SubmissionUser,
    SubmissionUserRole,
    UserTeam,
)

# IDs from tests/fixtures/ts1_baseline.json
TEAM_ID   = "3a7c5f8e-1b9d-4e2a-8f6c-0d3b7a5e9c1f"
USER_ID   = "8e2f4a6c-0b1d-4c9e-a7b5-3f1d8e2c6a0b"
MODEL_ID  = "1c9e7b3a-5f2d-4a8c-b6e0-9d1f3c7a5b2e"
SUB_ID    = "6f0d4e2a-8c1b-4b7d-a9e3-5c2f0d8a6b4e"

PRESIGN_BODY = {
    "team_id": TEAM_ID,
    "model_id": MODEL_ID,
    "label": "test-run",
    "task_ids": ["ts1-reward", "ts1-choice"],
    "is_public": True,
}


async def test_health(client):
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


async def test_users_me_upserts_dev_user(client):
    r = await client.get("/api/users/me")
    assert r.status_code == 200
    assert r.json()["email"] == "dev@brainwidebench.org"


async def test_presign_s3_key_embeds_submission_id(client, session_factory):
    """Regression: s3_key must contain the real submission UUID, never 'None'."""
    # Need a team and model in the DB before presigning.
    from tests.fixtures.load import load_fixture
    from pathlib import Path
    async with session_factory() as s:
        await load_fixture(s, Path(__file__).parent / "fixtures" / "ts1_baseline.json")

    r = await client.post("/api/submissions/presign", json=PRESIGN_BODY)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["submission_id"] in body["s3_key"]
    assert "None" not in body["s3_key"]


async def test_presign_persists_and_lists(client, session_factory):
    from tests.fixtures.load import load_fixture
    from pathlib import Path
    async with session_factory() as s:
        await load_fixture(s, Path(__file__).parent / "fixtures" / "ts1_baseline.json")

    await client.post("/api/submissions/presign", json=PRESIGN_BODY)
    r = await client.get("/api/submissions/")
    assert r.status_code == 200
    # listing is scoped to the current user; the fixture submission belongs to a
    # different user, so only the one just created via presign shows up.
    assert len(r.json()) == 1


async def test_presign_unknown_task_rejected(client, session_factory):
    from tests.fixtures.load import load_fixture
    from pathlib import Path
    async with session_factory() as s:
        await load_fixture(s, Path(__file__).parent / "fixtures" / "ts1_baseline.json")

    r = await client.post("/api/submissions/presign", json={**PRESIGN_BODY, "task_ids": ["ts99-bogus"]})
    assert r.status_code == 400


async def test_submit_marks_pending_and_enqueues(client, session_factory):
    """Regression: the presign→submit commit path must not raise MissingGreenlet."""
    from tests.fixtures.load import load_fixture
    from pathlib import Path
    async with session_factory() as s:
        await load_fixture(s, Path(__file__).parent / "fixtures" / "ts1_baseline.json")

    pr = await client.post("/api/submissions/presign", json=PRESIGN_BODY)
    sid = pr.json()["submission_id"]
    r = await client.post(f"/api/submissions/{sid}/submit")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "pending"


async def test_get_submission_detail(client, session_factory):
    from tests.fixtures.load import load_fixture
    from pathlib import Path
    async with session_factory() as s:
        await load_fixture(s, Path(__file__).parent / "fixtures" / "ts1_baseline.json")

    # Detail is owner/collaborator only; add the dev user as a collaborator on
    # the fixture submission so this test can read it.
    me = await client.get("/api/users/me")
    async with session_factory() as s:
        s.add(
            SubmissionUser(
                submission_id=uuid.UUID(SUB_ID),
                user_id=uuid.UUID(me.json()["id"]),
                role=SubmissionUserRole.collaborator,
            )
        )
        await s.commit()

    r = await client.get(f"/api/submissions/{SUB_ID}")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == SUB_ID
    assert len(body["task_submissions"]) == 8


async def test_leaderboard_shows_fixture_submission(seeded_client):
    """The fixture submission is public+done, so it must appear on the leaderboard."""
    r = await seeded_client.get("/api/leaderboard")
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 1
    row = rows[0]
    assert row["model_name"] == "mlp-baseline"
    assert row["team_name"] == "Brain Wide Bench"
    scores = row["scores"]
    assert "ts1-reward" in scores
    assert scores["ts1-reward"]["mean"] == 0.85


async def test_get_model_hides_private_submissions_from_non_members(seeded_client):
    """A viewer outside the model's team must not see its private submissions."""
    r = await seeded_client.get(f"/api/models/{MODEL_ID}")
    assert r.status_code == 200
    body = r.json()
    assert body["team_name"] == "Brain Wide Bench"
    assert all(s["is_public"] for s in body["submissions"])


async def test_get_model_shows_all_submissions_to_team_member(seeded_client, session_factory):
    """A member of the model's team sees both public and private submissions."""
    me = await seeded_client.get("/api/users/me")
    async with session_factory() as s:
        s.add(UserTeam(user_id=uuid.UUID(me.json()["id"]), team_id=uuid.UUID(TEAM_ID)))
        await s.commit()

    r = await seeded_client.get(f"/api/models/{MODEL_ID}")
    assert r.status_code == 200
    assert len(r.json()["submissions"]) >= 1


async def test_get_model_not_found(seeded_client):
    r = await seeded_client.get(f"/api/models/{uuid.uuid4()}")
    assert r.status_code == 404


async def test_users_me_models_scoped_to_team_membership(seeded_client, session_factory):
    """Only models on teams the user belongs to are listed."""
    r = await seeded_client.get("/api/users/me/models")
    assert r.status_code == 200
    assert r.json() == []

    me = await seeded_client.get("/api/users/me")
    async with session_factory() as s:
        s.add(UserTeam(user_id=uuid.UUID(me.json()["id"]), team_id=uuid.UUID(TEAM_ID)))
        await s.commit()

    r = await seeded_client.get("/api/users/me/models")
    assert r.status_code == 200
    assert [m["id"] for m in r.json()] == [MODEL_ID]
