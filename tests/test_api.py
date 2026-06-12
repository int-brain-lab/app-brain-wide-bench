"""In-process API tests (no containers).

Each of the two bugs found during the first ``docker compose`` bring-up has a
named regression test below:

- ``test_presign_s3_key_embeds_submission_id`` — the s3_key was ``submissions/None/…``
  because the UUID default was not populated when the key was built.
- ``test_submit_marks_pending_and_enqueues`` — exercises the commit + relationship
  path that previously raised ``MissingGreenlet`` (async lazy-load after flush).
"""

import uuid

from sqlalchemy import select

from app.models import Submission, SubmissionStatus

PRESIGN_BODY = {
    "title": "Test sub",
    "description": "d",
    "affiliation": "IBL",
    "email": "x@y.z",
    "task": "ts1",
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


async def test_presign_s3_key_embeds_submission_id(client):
    """Regression: s3_key must contain the real submission UUID, never 'None'."""
    r = await client.post("/api/submissions/presign", json=PRESIGN_BODY)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["s3_key"] == f"submissions/{body['submission_id']}/ts1.zip"
    assert "None" not in body["s3_key"]


async def test_presign_persists_and_lists(client):
    await client.post("/api/submissions/presign", json=PRESIGN_BODY)
    r = await client.get("/api/submissions/")
    assert r.status_code == 200
    assert len(r.json()) == 1


async def test_submit_marks_pending_and_enqueues(client):
    """Regression: the presign→submit commit path must not raise MissingGreenlet."""
    pr = await client.post("/api/submissions/presign", json=PRESIGN_BODY)
    sid = pr.json()["submission_id"]
    r = await client.post(f"/api/submissions/{sid}/submit")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "pending"


async def test_get_submission_detail(client):
    pr = await client.post("/api/submissions/presign", json=PRESIGN_BODY)
    sid = pr.json()["submission_id"]
    r = await client.get(f"/api/submissions/{sid}")
    assert r.status_code == 200
    assert r.json()["id"] == sid


async def test_unsupported_task_rejected(client):
    r = await client.post("/api/submissions/presign", json={**PRESIGN_BODY, "task": "ts9"})
    assert r.status_code == 422  # rejected by the Literal["ts1"] schema


async def test_leaderboard_shows_public_done(client, session_factory):
    pr = await client.post("/api/submissions/presign", json=PRESIGN_BODY)
    sid = pr.json()["submission_id"]

    # Promote to a scored, public submission directly in the DB.
    async with session_factory() as s:
        sub = (
            await s.execute(select(Submission).where(Submission.id == uuid.UUID(sid)))
        ).scalar_one()
        sub.status = SubmissionStatus.done
        sub.score_results = {"summary": {"ts1-choice": {"mean": 0.9, "sem": None, "n": 1}}}
        await s.commit()

    r = await client.get("/api/leaderboard")
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 1
    assert rows[0]["summary"]["ts1-choice"]["mean"] == 0.9
