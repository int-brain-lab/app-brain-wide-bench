"""``GET /api/meta``: the document the frontend's forms are built from, and its caching.

The shape assertions are here because the frontend resolves its field options and help text
by these exact keys, and a rename would show up as a form with empty dropdowns rather than
as an error. The caching assertions are here because the ETag is the whole reason the
frontend can refetch on every page navigation and not care.
"""

from app.models import (
    SUITE_OUTPUT_MODALITY,
    Calibration,
    FinetuningStrategy,
    Modality,
    Model,
    Submission,
    SupervisionRegime,
    TaskSubmission,
    TrainingParadigm,
)

META_URL = "/api/meta"

DESCRIBED_ENUMS = {
    "modality": Modality,
    "training_paradigm": TrainingParadigm,
    "supervision_regime": SupervisionRegime,
    "calibration": Calibration,
    "finetuning_strategy": FinetuningStrategy,
}


# ── shape ─────────────────────────────────────────────────────────────────────


async def test_is_public(client):
    """No token — the forms are rendered before anyone signs in, and a create page that
    needed auth for its dropdowns would show an empty one to a signed-out visitor."""
    response = await client.get(META_URL)

    assert response.status_code == 200
    assert set(response.json()) == {"enums", "fields", "tasks", "suites"}


async def test_enums_are_keyed_by_type_with_every_member(client):
    enums = (await client.get(META_URL)).json()["enums"]

    assert set(enums) == set(DESCRIBED_ENUMS)

    for name, described_enum in DESCRIBED_ENUMS.items():
        assert [option["value"] for option in enums[name]] == [m.value for m in described_enum]
        assert all(option["description"].strip() for option in enums[name])


async def test_modality_offers_every_member(client):
    """The model form's pretrained-modality pickers previously hardcoded three of the five,
    which is the drift this endpoint exists to stop."""
    modalities = (await client.get(META_URL)).json()["enums"]["modality"]

    assert [option["value"] for option in modalities] == [
        "anatomy",
        "spikes",
        "behavior",
        "lfp",
        "waveforms",
    ]


async def test_fields_match_the_models(client):
    fields = (await client.get(META_URL)).json()["fields"]

    assert fields["model"] == Model.FIELD_DESCRIPTIONS
    assert fields["submission"] == Submission.FIELD_DESCRIPTIONS
    assert fields["task_submission"] == TaskSubmission.FIELD_DESCRIPTIONS


async def test_tasks_and_suites(client):
    body = (await client.get(META_URL)).json()
    tasks = body["tasks"]

    assert tasks == sorted(tasks, key=lambda task: task["id"])
    assert {"id", "task_suite", "task_type", "primary_metric"} == set(tasks[0])

    assert body["suites"] == {
        suite.value: {"output_modality": modality.value}
        for suite, modality in SUITE_OUTPUT_MODALITY.items()
    }
    # Every suite a seeded task belongs to is described, since the task form reads the
    # output modality by suite to decide which modality can't also be an input.
    assert {task["task_suite"] for task in tasks} <= set(body["suites"])


# ── caching ───────────────────────────────────────────────────────────────────


async def test_sends_an_etag_and_revalidates(client):
    response = await client.get(META_URL)

    assert response.headers["etag"]
    assert response.headers["cache-control"] == "public, no-cache"


async def test_matching_etag_gets_304_with_no_body(client):
    first = await client.get(META_URL)

    second = await client.get(META_URL, headers={"If-None-Match": first.headers["etag"]})

    assert second.status_code == 304
    assert not second.content
    assert second.headers["etag"] == first.headers["etag"]


async def test_stale_etag_gets_the_document(client):
    response = await client.get(META_URL, headers={"If-None-Match": '"stale"'})

    assert response.status_code == 200
    assert response.json()["enums"]


async def test_etag_is_stable_across_requests(client):
    """It's a hash of the body, so an unstable one would mean every navigation re-downloads
    — the failure this endpoint's caching is meant to avoid, and a silent one."""
    first = await client.get(META_URL)
    second = await client.get(META_URL)

    assert first.headers["etag"] == second.headers["etag"]
    assert first.content == second.content


async def test_old_enums_endpoint_is_gone(client):
    """Replaced by the document above. Asserted so the frontend can't keep a stale caller
    working by accident."""
    assert (await client.get("/api/meta/enums")).status_code == 404
