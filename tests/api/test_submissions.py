"""Tests for the submissions router.

The main rules are:

- Listing and reading follow visibility: a public submission is visible to everyone;
  a private submission is visible only to members of its team.
- Public submissions hide team-only fields such as ``s3_key`` and ``narrative_private``.
- Creating, submitting and editing are member-only.
- A submission's team follows its model; callers cannot choose it directly.
- Moving a submission to another team's model requires membership of the destination team.
- Prevalidation is advisory and detail-free: it takes a path list, never a file, and relays
  only codes and their safe messages.
- An upload has a lifecycle. The upload endpoints act only while a file is still arriving.
- A label held by the caller's own unfinished attempt restarts that attempt; only one whose
  file has arrived collides.
- The size limit is enforced against the assembled object, not the size the client claimed.
"""

import uuid

import pytest_asyncio
from sqlalchemy.orm import selectinload

from app.config import settings
from app.models import Submission, SubmissionStatus, UserTeam
from app.validation.validate_submission import TS1_TASK_IDS, TS3_TASK_IDS
from tests.conftest import MODELS, SUBMISSIONS, TEAMS

PUBLIC = SUBMISSIONS["mlp-ts1-baseline"]
PRIVATE = SUBMISSIONS["mlp-ts1-rerun"]

BASELINE = MODELS["mlp-baseline"]
OTHER_TEAM_MODEL = MODELS["unsubmitted-net"]

MY_TEAM = TEAMS["Brain Wide Bench"]
OTHER_TEAM = TEAMS["Int Brain Lab"]


# What the uploading fixture below declares, and the parts it comes to at the configured
# part size: ceil(200 / 64).
UPLOADING_SIZE = 200 * 1024 * 1024
UPLOADING_PARTS = 4

TS1_TASK = min(TS1_TASK_IDS)
TS3_TASK = min(TS3_TASK_IDS)


@pytest_asyncio.fixture
async def uploading(add):
    """A submission of ``BASELINE`` whose file is still arriving. Returns its id.

    Local to this module rather than in ``api_tests.json``: a shared row would shift the
    submission counts eight other tests assert, for something only the upload endpoints need.
    """
    submission_id = uuid.uuid4()

    await add(
        Submission(
            id=submission_id,
            model_id=BASELINE,
            label="mlp-ts1-uploading",
            s3_key=f"submissions/{submission_id}/mlp-ts1-uploading.zip",
            status=SubmissionStatus.uploading,
            file_size=UPLOADING_SIZE,
            upload_id="mock-upload",
        )
    )

    return submission_id


@pytest_asyncio.fixture
async def validated(add):
    """A submission of ``BASELINE`` whose file passed validation. Returns its id.

    ``validation`` is what the worker writes: no codes, and the tasks the archive held.
    """
    submission_id = uuid.uuid4()

    await add(
        Submission(
            id=submission_id,
            model_id=BASELINE,
            label="mlp-ts1-validated",
            s3_key=f"submissions/{submission_id}/mlp-ts1-validated.zip",
            status=SubmissionStatus.pending,
            file_size=UPLOADING_SIZE,
            validation={
                "codes": [],
                "omitted": {},
                "tasks": ["ts1-choice", "ts1-reward", "ts2-co_smoothing"],
                "deterministic": False,
                "n_files": 45,
                "finished_at": "2026-09-08T11:20:31+00:00",
            },
        )
    )

    return submission_id


@pytest_asyncio.fixture
async def published_in_flight(add):
    """A submission marked public whose file is still arriving. Returns its id.

    The combination that has to stay hidden: ``is_public`` says the submitter intends to
    publish, and the file may never exist.
    """
    submission_id = uuid.uuid4()

    await add(
        Submission(
            id=submission_id,
            model_id=BASELINE,
            label="mlp-ts1-inflight",
            s3_key=f"submissions/{submission_id}/mlp-ts1-inflight.zip",
            status=SubmissionStatus.uploading,
            file_size=UPLOADING_SIZE,
            upload_id="mock-upload",
            is_public=True,
        )
    )

    return submission_id


def create_body(**overrides):
    """Return the minimal valid create request."""
    return {
        "model_id": str(BASELINE),
        "label": "new-run",
        "file_size": UPLOADING_SIZE,
        "is_public": False,
        **overrides,
    }


def seed_entries(task=TS1_TASK, recording="rec1", seeds=(1, 2, 3), label="mlp"):
    """Prediction entries for one task, as a zip's central directory would list them."""
    return [f"{label}/{task}/{recording}/seed_{seed}.safetensors" for seed in seeds]


def codes(response):
    """The error codes in a prevalidate or validation response, in order."""
    return [error["code"] for error in response.json()["errors"]]


def part_numbers(response, field="part_urls"):
    """The part numbers in an upload response's ``field``."""
    return sorted(part["part_number"] for part in response.json()[field])


def labels(response):
    """Return submission labels in a stable order."""
    return sorted(row["label"] for row in response.json())


def submissions_url(submission_id=None):
    """The collection, or one submission within it."""
    url = "/api/submissions"

    return url if submission_id is None else f"{url}/{submission_id}"


def prevalidate_url():
    """Where an entry list is checked, before there is a submission to attach it to."""
    return f"{submissions_url()}/prevalidate"


def upload_url(submission_id, action=None):
    """One submission's upload: its state, or an action on it."""
    url = f"{submissions_url(submission_id)}/upload"

    return url if action is None else f"{url}/{action}"


def submit_url(submission_id):
    return f"{submissions_url(submission_id)}/submit"


def validation_url(submission_id):
    return f"{submissions_url(submission_id)}/validation"


def submit_body(*task_ids, **overrides):
    """Return a submit request configuring ``task_ids``."""
    return {"tasks": [{"task_id": task_id} for task_id in task_ids], **overrides}


# ── POST /api/submissions/prevalidate ─────────────────────────────────────────


async def test_prevalidate_accepts_a_well_formed_entry_list(seeded_client):
    """A well-formed list passes, and reports the tasks it found.

    Passes only because no ground truth is configured in tests: session coverage (E104)
    needs it and is skipped without it.
    """
    response = await seeded_client.post(
        prevalidate_url(),
        json={
            "entries": seed_entries() + [f"mlp/{TS3_TASK}/seed_{n}.safetensors" for n in (1, 2, 3)],
            "is_deterministic": False,
        },
    )

    assert response.status_code == 200

    body = response.json()

    assert body["ok"] is True
    assert body["errors"] == []
    assert body["n_files"] == 6
    assert body["tasks"] == sorted([TS1_TASK, TS3_TASK])


async def test_prevalidate_reports_codes_without_details(seeded_client):
    """Findings come back as codes with safe messages, and never as internal detail."""
    response = await seeded_client.post(
        prevalidate_url(),
        json={
            "entries": seed_entries(seeds=(1,)) + ["mlp/notes.md"],
            "is_deterministic": False,
        },
    )

    assert response.status_code == 200

    body = response.json()

    assert body["ok"] is False
    assert sorted(codes(response)) == ["E014", "E101"]
    assert all(error["message"] for error in body["errors"])

    # The detail for these two names the seed count and the offending path.
    assert "notes.md" not in response.text
    assert "need >=" not in response.text


async def test_prevalidate_faults_a_misnamed_seed_file_as_its_own_code(seeded_client):
    """A file meant to be a prediction file is E004, not E014, and is faulted once."""
    response = await seeded_client.post(
        prevalidate_url(),
        json={"entries": seed_entries() + [f"mlp/{TS1_TASK}/rec1/seed_x.safetensors"]},
    )

    assert codes(response) == ["E004"]


async def test_prevalidate_honours_is_deterministic(seeded_client):
    """The seed checks apply only to a model that has randomness to seed."""
    one_seed = {"entries": seed_entries(seeds=(1,))}

    response = await seeded_client.post(
        prevalidate_url(), json=one_seed | {"is_deterministic": False}
    )

    assert codes(response) == ["E101"]

    response = await seeded_client.post(
        prevalidate_url(), json=one_seed | {"is_deterministic": True}
    )

    assert response.json()["ok"] is True


async def test_prevalidate_reports_an_empty_archive(seeded_client):
    """An archive with no prediction files fails with nothing to fault — hence n_files."""
    response = await seeded_client.post(prevalidate_url(), json={"entries": []})

    assert response.status_code == 200

    body = response.json()

    assert body["ok"] is False
    assert body["n_files"] == 0
    assert body["errors"] == []


async def test_prevalidate_rejects_too_many_entries(seeded_client):
    """An entry list past the cap is refused rather than crawled."""
    response = await seeded_client.post(
        prevalidate_url(), json={"entries": [f"mlp/f{n}" for n in range(50_001)]}
    )

    assert response.status_code == 422


async def test_prevalidate_rejects_unknown_fields(seeded_client):
    """Only the documented fields are accepted."""
    response = await seeded_client.post(
        prevalidate_url(), json={"entries": seed_entries(), "gt_dir": "/etc"}
    )

    assert response.status_code == 422


# ── POST /api/submissions ─────────────────────────────────────────────────────


async def test_create_as_non_member(seeded_client):
    """A non-member cannot create a submission."""
    response = await seeded_client.post(submissions_url(), json=create_body())

    assert response.status_code == 403


async def test_create_as_member(seeded_client, add, me, session_factory):
    """A member creates a submission and receives an upload to send its file to."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(submissions_url(), json=create_body())

    assert response.status_code == 200

    body = response.json()

    assert body["upload_id"]
    assert body["part_size"] == settings.upload_part_size
    assert body["part_count"] == UPLOADING_PARTS
    assert len(body["part_urls"]) == UPLOADING_PARTS
    assert body["uploaded"] == []

    async with session_factory() as session:
        submission = await session.get(Submission, uuid.UUID(body["submission_id"]))

    assert submission.status == SubmissionStatus.uploading
    assert submission.file_size == UPLOADING_SIZE
    assert submission.upload_id == body["upload_id"]


async def test_create_returns_a_url_for_every_part(seeded_client, add, me):
    """Every part is signed up front; the client needs no top-up in the normal case."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(
        submissions_url(), json=create_body(file_size=10 * settings.upload_part_size)
    )

    assert response.json()["part_count"] == 10
    assert part_numbers(response) == list(range(1, 11))


async def test_create_slugifies_the_label_into_the_key(seeded_client, add, me):
    """A label with path characters cannot escape the submission's own prefix."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(
        submissions_url(), json=create_body(label="../../etc/passwd")
    )

    assert response.status_code == 200

    body = response.json()

    assert body["s3_key"] == f"submissions/{body['submission_id']}/etc-passwd.zip"


async def test_create_unknown_model(seeded_client, add, me):
    """A submission must name a model that exists."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(
        submissions_url(), json=create_body(model_id=str(uuid.uuid4()))
    )

    assert response.status_code == 404


async def test_create_rejects_unknown_fields(seeded_client, add, me):
    """Task metadata arrives at submit, not create — so it is not accepted here."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(
        submissions_url(), json=create_body(tasks=[{"task_id": "ts1-reward"}])
    )

    assert response.status_code == 422


async def test_create_rejects_a_blank_label(seeded_client, add, me):
    """A submission needs a label to be identified by."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(submissions_url(), json=create_body(label="   "))

    assert response.status_code == 422


async def test_create_rejects_a_file_over_the_size_limit(seeded_client, add, me):
    """A file too large to accept is refused before any of it is sent."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(
        submissions_url(), json=create_body(file_size=settings.max_submission_bytes + 1)
    )

    assert response.status_code == 422


async def test_create_rejects_an_empty_file(seeded_client, add, me):
    """A file has to have something in it."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(submissions_url(), json=create_body(file_size=0))

    assert response.status_code == 422


async def test_create_rejects_a_label_a_finished_submission_uses(seeded_client, add, me):
    """A label belonging to a submission whose file has arrived is taken."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(
        submissions_url(), json=create_body(label="mlp-ts1-baseline")
    )

    assert response.status_code == 409


async def test_create_compares_labels_case_insensitively(seeded_client, add, me):
    """Two submissions on one model cannot differ only in case."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(
        submissions_url(), json=create_body(label="MLP-TS1-Baseline")
    )

    assert response.status_code == 409


async def test_create_allows_another_model_the_same_label(seeded_client, add, me):
    """A label names a run of one model, so another model may reuse it."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))
    await add(UserTeam(user_id=me, team_id=OTHER_TEAM))

    response = await seeded_client.post(
        submissions_url(),
        json=create_body(model_id=str(OTHER_TEAM_MODEL), label="mlp-ts1-baseline"),
    )

    assert response.status_code == 200


async def test_create_resumes_an_upload_of_the_same_size(
    seeded_client, uploading, add, me, monkeypatch
):
    """The same label and size picks the stalled upload back up, keeping its parts.

    Only the missing parts are signed: the point of resuming is not to send again what
    already arrived.
    """
    import app.routers.submissions as router

    monkeypatch.setattr(router, "list_parts", lambda key, upload_id: {1: '"a"', 2: '"b"'})
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(
        submissions_url(), json=create_body(label="mlp-ts1-uploading")
    )

    assert response.status_code == 200

    body = response.json()

    assert body["submission_id"] == str(uploading)
    assert body["part_count"] == UPLOADING_PARTS
    assert part_numbers(response, "uploaded") == [1, 2]
    assert part_numbers(response) == [3, 4]


async def test_create_restarts_an_upload_of_a_different_size(
    seeded_client, uploading, add, me, monkeypatch, session_factory
):
    """A different size means a different file, so the stale upload is abandoned."""
    import app.routers.submissions as router

    aborted = []
    monkeypatch.setattr(router, "abort_multipart", lambda key, upload_id: aborted.append(upload_id))
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(
        submissions_url(),
        json=create_body(
            label="mlp-ts1-uploading",
            file_size=7 * settings.upload_part_size,
            narrative_public="second attempt",
        ),
    )

    assert response.status_code == 200
    assert response.json()["submission_id"] == str(uploading)
    assert aborted == ["mock-upload"]
    assert part_numbers(response) == list(range(1, 8))

    async with session_factory() as session:
        submission = await session.get(Submission, uploading)

    assert submission.file_size == 7 * settings.upload_part_size
    assert submission.narrative_public == "second attempt"


async def test_create_reuses_the_label_of_an_invalid_submission(
    seeded_client, add, me, session_factory
):
    """A submission that failed validation does not hold its label against a corrected one.

    Its file was deleted when it failed, so there is nothing to resume: the row goes back to
    ``uploading`` with a new upload and no verdict.
    """
    failed_id = uuid.uuid4()
    await add(
        Submission(
            id=failed_id,
            model_id=BASELINE,
            label="mlp-ts1-fixed",
            s3_key=f"submissions/{failed_id}/mlp-ts1-fixed.zip",
            status=SubmissionStatus.invalid,
            file_size=UPLOADING_SIZE,
            validation={"codes": [{"code": "E001", "path": "."}], "tasks": []},
        )
    )
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(submissions_url(), json=create_body(label="mlp-ts1-fixed"))

    assert response.status_code == 200
    assert response.json()["submission_id"] == str(failed_id)

    async with session_factory() as session:
        submission = await session.get(Submission, failed_id)

    assert submission.status == SubmissionStatus.uploading
    assert submission.validation is None
    assert submission.upload_id


async def test_create_refuses_a_restart_for_a_non_member(seeded_client, uploading):
    """Picking up an existing attempt is still membership-gated."""
    response = await seeded_client.post(
        submissions_url(), json=create_body(label="mlp-ts1-uploading")
    )

    assert response.status_code == 403


# ── GET /api/submissions/{id}/upload ──────────────────────────────────────────


async def test_get_upload_as_non_member(seeded_client, uploading):
    """An upload's state is the team's."""
    response = await seeded_client.get(upload_url(uploading))

    assert response.status_code == 403


async def test_get_upload_reports_stored_parts_and_signs_what_is_asked_for(
    seeded_client, uploading, add, me, monkeypatch
):
    """The recovery read: what S3 holds, fresh signatures for what it does not, uncacheable."""
    import app.routers.submissions as router

    monkeypatch.setattr(router, "list_parts", lambda key, upload_id: {1: '"a"', 2: '"b"'})
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.get(upload_url(uploading), params={"parts": [3, 4]})

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"

    assert response.json()["part_count"] == UPLOADING_PARTS
    assert part_numbers(response, "uploaded") == [1, 2]
    assert part_numbers(response) == [3, 4]


async def test_get_upload_rejects_a_submission_whose_file_has_arrived(seeded_client, add, me):
    """There is nothing to sign once the object exists."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.get(upload_url(PUBLIC))

    assert response.status_code == 409


async def test_get_upload_not_found(seeded_client, add, me):
    """An unknown submission is a 404. The four upload endpoints share this lookup."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.get(upload_url(uuid.uuid4()))

    assert response.status_code == 404


# ── POST /api/submissions/{id}/upload/complete ────────────────────────────────


async def test_upload_complete_as_non_member(seeded_client, uploading):
    """Only the team may finish its upload."""
    response = await seeded_client.post(
        upload_url(uploading, "complete"), json={"parts": [{"part_number": 1, "etag": '"a"'}]}
    )

    assert response.status_code == 403


async def test_upload_complete_queues_validation(
    seeded_client, uploading, add, me, queued, session_factory
):
    """Completing the upload is what starts validation: the object first exists here."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(
        upload_url(uploading, "complete"),
        json={"parts": [{"part_number": n, "etag": f'"{n}"'} for n in range(1, 5)]},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "validating"
    assert queued["validate"] == [str(uploading)]

    async with session_factory() as session:
        submission = await session.get(Submission, uploading)

    assert submission.status == SubmissionStatus.validating
    assert submission.upload_id is None


async def test_upload_complete_rejects_a_submission_whose_file_has_arrived(
    seeded_client, add, me, queued
):
    """A second completion has nothing to assemble, and must not re-queue validation."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(
        upload_url(PUBLIC, "complete"), json={"parts": [{"part_number": 1, "etag": '"a"'}]}
    )

    assert response.status_code == 409
    assert queued["validate"] == []


async def test_upload_complete_rejects_an_empty_part_list(seeded_client, uploading, add, me):
    """An upload with no parts is not an upload."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(upload_url(uploading, "complete"), json={"parts": []})

    assert response.status_code == 422


async def test_upload_complete_refuses_an_oversize_object(
    seeded_client, uploading, add, me, queued, monkeypatch, session_factory
):
    """The limit is enforced against the object, whatever size the client declared.

    A part may be up to 5 GB, so the declared size at create bounds nothing.
    """
    import app.routers.submissions as router

    deleted = []
    monkeypatch.setattr(router, "submission_size", lambda key: settings.max_submission_bytes + 1)
    monkeypatch.setattr(router, "delete_submission_file", lambda key: deleted.append(key))
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(
        upload_url(uploading, "complete"), json={"parts": [{"part_number": 1, "etag": '"a"'}]}
    )

    assert response.status_code == 413
    assert queued["validate"] == []
    assert len(deleted) == 1

    async with session_factory() as session:
        submission = await session.get(Submission, uploading)

    assert submission.status == SubmissionStatus.invalid


# ── DELETE /api/submissions/{id} ──────────────────────────────────────────────


async def test_delete_as_non_member(seeded_client, uploading):
    """Only the team may abandon its own submission."""
    response = await seeded_client.delete(submissions_url(uploading))

    assert response.status_code == 403


async def test_delete_releases_the_parts_of_an_unfinished_upload(
    seeded_client, uploading, add, me, monkeypatch, session_factory
):
    """A file still arriving has stored parts and no object, so the upload is aborted."""
    import app.routers.submissions as router

    aborted = []
    deleted = []
    monkeypatch.setattr(router, "abort_multipart", lambda key, upload_id: aborted.append(upload_id))
    monkeypatch.setattr(router, "delete_submission_file", lambda key: deleted.append(key))
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.delete(submissions_url(uploading))

    assert response.status_code == 204
    assert aborted == ["mock-upload"]
    assert deleted == []

    async with session_factory() as session:
        assert await session.get(Submission, uploading) is None


async def test_delete_removes_the_object_of_a_validated_submission(
    seeded_client, validated, add, me, monkeypatch, session_factory
):
    """A validated file is an object with no upload behind it, so the object goes."""
    import app.routers.submissions as router

    aborted = []
    deleted = []
    monkeypatch.setattr(router, "abort_multipart", lambda key, upload_id: aborted.append(upload_id))
    monkeypatch.setattr(router, "delete_submission_file", lambda key: deleted.append(key))
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.delete(submissions_url(validated))

    assert response.status_code == 204
    assert deleted != []
    assert aborted == []

    async with session_factory() as session:
        assert await session.get(Submission, validated) is None


async def test_delete_refuses_a_submission_being_validated(
    seeded_client, uploading, add, me, session_factory
):
    """A worker is reading it; deleting the row would make its final write raise."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    async with session_factory() as session:
        submission = await session.get(Submission, uploading)
        submission.status = SubmissionStatus.validating
        await session.commit()

    response = await seeded_client.delete(submissions_url(uploading))

    assert response.status_code == 409

    async with session_factory() as session:
        assert await session.get(Submission, uploading) is not None


async def test_delete_refuses_a_submission_that_has_been_scored(
    seeded_client, add, me, session_factory
):
    """Abandoning stops where a submission becomes a result."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.delete(submissions_url(PUBLIC))

    assert response.status_code == 409

    async with session_factory() as session:
        assert await session.get(Submission, PUBLIC) is not None



# ── GET /api/submissions/{id}/validation ──────────────────────────────────────


async def test_validation_as_non_member(seeded_client, validated):
    """A verdict is the submitter's own feedback, not something a submission publishes."""
    response = await seeded_client.get(validation_url(validated))

    assert response.status_code == 403


async def test_validation_reports_a_passing_verdict(seeded_client, validated, add, me):
    """A file that passed reports the tasks it held and nothing to fix."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.get(validation_url(validated))

    assert response.status_code == 200

    body = response.json()

    assert body["state"] == "pending"
    assert body["errors"] == []
    assert body["n_files"] == 45
    assert body["tasks"] == ["ts1-choice", "ts1-reward", "ts2-co_smoothing"]


async def test_validation_resolves_messages_and_withholds_details(seeded_client, add, me):
    """Each stored code comes back with its safe message, and no internal detail exists to leak.

    E101 has a specific message; E006 falls back to the generic one.
    """
    failed_id = uuid.uuid4()
    await add(
        Submission(
            id=failed_id,
            model_id=BASELINE,
            label="mlp-ts1-failed",
            s3_key=f"submissions/{failed_id}/mlp-ts1-failed.zip",
            status=SubmissionStatus.invalid,
            validation={
                "codes": [
                    {"code": "E101", "path": "."},
                    {"code": "E006", "path": "a/b.safetensors"},
                ],
                "omitted": {"E006": 12},
                "tasks": [],
                "n_files": 3,
            },
        )
    )
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.get(validation_url(failed_id))

    assert response.status_code == 200

    body = response.json()

    assert body["state"] == "invalid"
    assert codes(response) == ["E101", "E006"]
    assert "at least 3 distinct seeds" in body["errors"][0]["message"]
    assert "prediction-saving infrastructure" in body["errors"][1]["message"]
    assert body["omitted"] == {"E006": 12}


async def test_validation_reports_a_run_in_progress(
    seeded_client, uploading, add, me, session_factory
):
    """While the worker is running there is no verdict yet, only a state."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    async with session_factory() as session:
        submission = await session.get(Submission, uploading)
        submission.status = SubmissionStatus.validating
        await session.commit()

    response = await seeded_client.get(validation_url(uploading))

    assert response.json()["state"] == "validating"
    assert response.json()["errors"] == []


async def test_validation_not_found(seeded_client, add, me):
    """An unknown submission has no verdict to read."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.get(validation_url(uuid.uuid4()))

    assert response.status_code == 404


# ── POST /api/submissions/{id}/submit ──────────────────────────────────────────


async def test_submit_as_non_member(seeded_client, validated):
    """A non-member cannot submit a submission."""
    response = await seeded_client.post(submit_url(validated), json=submit_body("ts1-reward"))

    assert response.status_code == 403


async def test_submit_configures_the_tasks_and_queues_scoring(
    seeded_client, validated, add, me, queued, session_factory
):
    """A member configures the tasks in the file and scoring starts."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(
        submit_url(validated), json=submit_body("ts1-reward", "ts1-choice")
    )

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "scoring"
    assert queued["score"] == [str(validated)]

    async with session_factory() as session:
        submission = await session.get(
            Submission, validated, options=[selectinload(Submission.task_submissions)]
        )

    assert submission.status == SubmissionStatus.scoring
    assert sorted(ts.task_id for ts in submission.task_submissions) == [
        "ts1-choice",
        "ts1-reward",
    ]


async def test_submit_allows_a_subset_of_the_files_tasks(
    seeded_client, validated, add, me, session_factory
):
    """The file may hold more than is submitted: the leaderboard is per task."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(submit_url(validated), json=submit_body("ts1-reward"))

    assert response.status_code == 200

    async with session_factory() as session:
        submission = await session.get(
            Submission, validated, options=[selectinload(Submission.task_submissions)]
        )

    assert [ts.task_id for ts in submission.task_submissions] == ["ts1-reward"]


async def test_submit_allows_tasks_spanning_suites(seeded_client, validated, add, me):
    """One submission may span suites; scoring runs a scorer per suite it names."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(
        submit_url(validated), json=submit_body("ts1-reward", "ts2-co_smoothing")
    )

    assert response.status_code == 200


async def test_submit_refuses_a_task_the_file_has_no_predictions_for(
    seeded_client, validated, add, me, queued
):
    """A task absent from the archive has nothing to score."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(
        submit_url(validated), json=submit_body("ts1-reward", "ts1-wheel_speed")
    )

    assert response.status_code == 400
    assert "ts1-wheel_speed" in response.json()["detail"]
    assert queued["score"] == []


async def test_submit_refuses_unknown_task_ids(seeded_client, validated, add, me):
    """Every task must exist in the task table."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(submit_url(validated), json=submit_body("ts1-nope"))

    assert response.status_code == 400


async def test_submit_refuses_duplicate_task_ids(seeded_client, validated, add, me):
    """A task can only appear once."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(
        submit_url(validated), json=submit_body("ts1-reward", "ts1-reward")
    )

    assert response.status_code == 400


async def test_submit_refuses_a_submission_still_uploading(
    seeded_client, uploading, add, me, queued
):
    """There is nothing to score until the file has arrived and been checked."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(submit_url(uploading), json=submit_body("ts1-reward"))

    assert response.status_code == 409
    assert queued["score"] == []


async def test_submit_refuses_a_submission_that_was_never_validated(seeded_client, add, me):
    """A row predating validation, or one seeded directly, is not submittable."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(
        submit_url(SUBMISSIONS["mlp-ts1-queued"]), json=submit_body("ts1-reward")
    )

    assert response.status_code == 409


async def test_submit_refuses_a_submission_that_failed_validation(seeded_client, add, me, queued):
    """A file that did not pass is not scored, and its object is gone anyway."""
    failed_id = uuid.uuid4()
    await add(
        Submission(
            id=failed_id,
            model_id=BASELINE,
            label="mlp-ts1-failed",
            s3_key=f"submissions/{failed_id}/mlp-ts1-failed.zip",
            status=SubmissionStatus.pending,
            validation={"codes": [{"code": "E101", "path": "."}], "tasks": ["ts1-reward"]},
        )
    )
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(submit_url(failed_id), json=submit_body("ts1-reward"))

    assert response.status_code == 409
    assert queued["score"] == []


async def test_submit_refuses_a_submission_that_could_not_be_checked(
    seeded_client, add, me, queued
):
    """Our failure, not the submitter's — so it says so rather than "already submitted"."""
    unchecked_id = uuid.uuid4()
    await add(
        Submission(
            id=unchecked_id,
            model_id=BASELINE,
            label="mlp-ts1-unchecked",
            s3_key=f"submissions/{unchecked_id}/mlp-ts1-unchecked.zip",
            status=SubmissionStatus.unchecked,
            validation={"codes": [{"code": "E999", "path": "."}], "tasks": []},
        )
    )
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(
        submit_url(unchecked_id), json=submit_body("ts1-reward")
    )

    assert response.status_code == 409
    assert "could not be checked" in response.json()["detail"]
    assert queued["score"] == []


async def test_create_reuses_the_label_of_an_unchecked_submission(seeded_client, add, me):
    """A submitter is not held behind our own failure to check their file."""
    unchecked_id = uuid.uuid4()
    await add(
        Submission(
            id=unchecked_id,
            model_id=BASELINE,
            label="mlp-ts1-unchecked",
            s3_key=f"submissions/{unchecked_id}/mlp-ts1-unchecked.zip",
            status=SubmissionStatus.unchecked,
            file_size=UPLOADING_SIZE,
        )
    )
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(
        submissions_url(), json=create_body(label="mlp-ts1-unchecked")
    )

    assert response.status_code == 200
    assert response.json()["submission_id"] == str(unchecked_id)


async def test_submit_refuses_a_submission_already_scored(seeded_client, add, me, queued):
    """Submitting twice would score the same file twice."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(submit_url(PUBLIC), json=submit_body("ts1-reward"))

    assert response.status_code == 409
    assert queued["score"] == []


async def test_submit_applies_the_form_fields_alongside_the_tasks(
    seeded_client, validated, add, me, session_factory
):
    """Panels 1-2 stayed editable while the file uploaded, so submit persists them."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(
        submit_url(validated),
        json=submit_body(
            "ts1-reward", label="renamed-at-submit", is_public=True, narrative_public="a note"
        ),
    )

    assert response.status_code == 200

    async with session_factory() as session:
        submission = await session.get(Submission, validated)

    assert submission.label == "renamed-at-submit"
    assert submission.is_public is True
    assert submission.narrative_public == "a note"

    # The key was built at upload start and names the label as it stood then.
    assert submission.s3_key.endswith("mlp-ts1-validated.zip")


async def test_submit_refuses_a_label_another_submission_uses(seeded_client, validated, add, me):
    """Renaming at submit is still subject to the label being free."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(
        submit_url(validated), json=submit_body("ts1-reward", label="mlp-ts1-baseline")
    )

    assert response.status_code == 409


async def test_submit_rejects_is_deterministic(seeded_client, validated, add, me):
    """The flag is fixed once a verdict was reached under it, so submit will not take it."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(
        submit_url(validated), json=submit_body("ts1-reward", is_deterministic=True)
    )

    assert response.status_code == 422


async def test_submit_not_found(seeded_client, add, me):
    """Submitting an unknown submission returns 404."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.post(submit_url(uuid.uuid4()), json=submit_body("ts1-reward"))

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


async def test_list_marks_which_submissions_are_mine(seeded_client, add, me):
    """``is_mine`` follows membership of the owning team.

    Every seeded submission is Brain Wide Bench's, so this is the two ends rather than a
    mixed listing: a non-member owns none of the public rows they can read, and a member
    owns all of them.
    """
    response = await seeded_client.get(submissions_url())

    assert response.status_code == 200
    assert [row["is_mine"] for row in response.json()] == [False]

    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.get(submissions_url())

    assert response.status_code == 200
    assert all(row["is_mine"] for row in response.json())


async def test_list_filtered_by_team(seeded_client, add, me):
    """``team_id`` narrows the list to one team's submissions."""
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.get(submissions_url(), params={"team_id": str(MY_TEAM)})

    assert response.status_code == 200
    assert labels(response) == [
        "mlp-ts1-baseline",
        "mlp-ts1-queued",
        "mlp-ts1-rerun",
        "mlp-ts3-internal",
        "ssl-ts2-pilot",
    ]

    # Int Brain Lab's only model has never been submitted.
    response = await seeded_client.get(submissions_url(), params={"team_id": str(OTHER_TEAM)})

    assert response.json() == []


async def test_list_filtered_by_team_still_hides_private(seeded_client):
    """``team_id`` narrows what is shown, never what is visible."""
    response = await seeded_client.get(submissions_url(), params={"team_id": str(MY_TEAM)})

    assert response.status_code == 200
    assert labels(response) == ["mlp-ts1-baseline"]


async def test_list_filtered_by_an_unknown_team_is_empty(seeded_client):
    """A team id that matches nothing is an empty list, not an error."""
    response = await seeded_client.get(submissions_url(), params={"team_id": str(uuid.uuid4())})

    assert response.status_code == 200
    assert response.json() == []


async def test_list_includes_submission_summary(seeded_client):
    """The list response includes the model, team and scored task-suite summary."""
    listed = {row["label"]: row for row in (await seeded_client.get(submissions_url())).json()}

    submission = listed["mlp-ts1-baseline"]

    assert submission["task_suites"] == ["ts1"]
    assert submission["model_name"] == "mlp-baseline"
    assert submission["team_name"] == "Brain Wide Bench"


async def test_list_hides_an_in_flight_submission_from_non_members(
    seeded_client, published_in_flight
):
    """Marking a submission public does not publish it before its file exists."""
    response = await seeded_client.get(submissions_url())

    assert response.status_code == 200
    assert "mlp-ts1-inflight" not in labels(response)


async def test_list_shows_a_team_its_own_in_flight_submissions(seeded_client, uploading, add, me):
    """A team sees its unfinished work, with its state.

    The only route back for a submitter who reloaded before finishing the form.
    """
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.get(submissions_url())

    assert "mlp-ts1-uploading" in labels(response)

    listed = {row["label"]: row for row in response.json()}

    assert listed["mlp-ts1-uploading"]["status"] == "uploading"


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
    assert body["is_mine"] is False


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
    assert body["is_mine"] is True


async def test_detail_not_found(seeded_client):
    """An unknown submission id returns 404."""
    response = await seeded_client.get(submissions_url(uuid.uuid4()))

    assert response.status_code == 404


async def test_detail_hides_an_in_flight_submission_from_non_members(
    seeded_client, published_in_flight
):
    """A public submission whose file has not arrived is still only its team's."""
    response = await seeded_client.get(submissions_url(published_in_flight))

    assert response.status_code == 403


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


async def test_update_rejects_a_label_the_model_already_uses(seeded_client, add, me):
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.patch(submissions_url(PUBLIC), json={"label": "mlp-ts1-rerun"})

    assert response.status_code == 409


async def test_update_allows_a_submission_to_keep_its_own_label(seeded_client, add, me):
    await add(UserTeam(user_id=me, team_id=MY_TEAM))

    response = await seeded_client.patch(
        submissions_url(PUBLIC), json={"label": "mlp-ts1-baseline"}
    )

    assert response.status_code == 200, response.text


async def test_update_refuses_a_move_that_collides(seeded_client, add, me):
    """Repointing at a model that already has a submission by this label is a conflict."""
    await add(
        UserTeam(user_id=me, team_id=MY_TEAM),
        Submission(
            id=uuid.uuid4(),
            model_id=MODELS["ssl-transformer"],
            label="mlp-ts1-baseline",
            s3_key="k",
            status=SubmissionStatus.done,
            is_public=False,
        ),
    )

    response = await seeded_client.patch(
        submissions_url(PUBLIC), json={"model_id": str(MODELS["ssl-transformer"])}
    )

    assert response.status_code == 409


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
