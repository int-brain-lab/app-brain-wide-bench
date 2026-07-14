# TS1 test fixtures

TS1 test data lives in two parts, mirroring the two things a real submission
produces: the predictions themselves, and the row of leaderboard metadata that
describes them.

| Part | File | Purpose |
|---|---|---|
| Submission zip | `tests/fixtures/sample.zip` (built from `tests/fixtures/mlp-baseline/`) | `.safetensors` predictions, exercised by `TS1Scorer` |
| DB metadata fixture | `tests/fixtures/ts1_baseline.json` | Seeds an in-memory DB for API tests |

The zip's internal layout (`<label>/<task>/<recording_id>/seed_N.safetensors`,
tensor shapes, metadata keys) is already documented in
[`README.md` § Submission format](../README.md#submission-format) — see there
for that part. `sample.zip` itself only covers 3 of the 8 TS1 tasks
(`ts1-whisker_motion_energy`, `ts1-licking_rate`, `ts1-reward`), each with 2
recordings × 5 seeds, which is enough to exercise `TS1Scorer.extract`/`.score`
but not a full leaderboard row.

This doc covers the other half: `ts1_baseline.json`, which is not yet
documented anywhere.

## `ts1_baseline.json`

A flat JSON dump of DB rows, loaded by `tests/fixtures/load.py::load_fixture`
into whatever SQLModel session a test provides (in-memory SQLite in
`tests/conftest.py`, not a real Postgres). It represents one fully-scored TS1
submission, `mlp-ts1-baseline`, covering all 8 `ts1-*` tasks.

Top-level keys are table names; each maps to a list of row dicts fed straight
into `ClassName.model_validate(row)` (see `app/models.py` for the full SQLModel
definitions). Insertion order in `load_fixture` follows FK dependencies:

```
teams → users → models → submissions → submission_users → task_submissions → task_scores
```

### `teams`, `users`

Straightforward identity rows — `Team(id, name)` and
`User(id, auth0_sub, email, name, affiliation, provider)`.

### `models`

One `Model` row: the architecture/pretraining metadata shown on the
leaderboard next to a submission.

| Field | Type | Notes |
|---|---|---|
| `id`, `team_id` | UUID | |
| `name` | str | e.g. `"mlp-baseline"` |
| `link_project`, `link_weights`, `link_code`, `publication_doi` | str \| null | external links |
| `n_parameters` | int \| null | |
| `temporal_context_s` | float | input window length |
| `is_pretrained` | bool \| null | |
| `pretrained_in_modalities`, `pretrained_out_modalities` | `Modality` enum \| null | `anatomy` \| `spikes` \| `behavior` |
| `pretraining_data` | str \| null | |

### `submissions`

One `Submission` row: the uploaded-zip record.

| Field | Type | Notes |
|---|---|---|
| `id`, `team_id`, `model_id` | UUID | |
| `label` | str | human-readable run name, e.g. `"mlp-ts1-baseline"` — matches the zip's top-level folder name |
| `s3_key` | str | `submissions/<id>/<label>.zip` |
| `status` | `SubmissionStatus` | `pending` \| `scoring` \| `done` \| `failed` |
| `is_public` | bool | gates leaderboard visibility |
| `narrative_public`, `narrative_private` | str \| null | free-text methodology blurb; private is owner-only |

### `submission_users`

M2M bridge row: `SubmissionUser(submission_id, user_id, role)`, `role` is
`SubmissionUserRole` (`owner` \| `collaborator`).

### `task_submissions`

One row per TS1 task the submission covers (8 rows in the fixture — one per
`ts1-*` task). This is the methodology metadata for *that specific task*
within the submission — different tasks in the same submission can use
different paradigms.

| Field | Type | Notes |
|---|---|---|
| `id`, `submission_id` | UUID | |
| `task_id` | str | flat task id, FK into the static `tasks` table, e.g. `"ts1-reward"` |
| `training_paradigm` | `TrainingParadigm` \| null | `TSS` (task-specific supervised) \| `TSU` (task-specific unsupervised, pretrained backbone) \| `single_session` |
| `calibration` | `Calibration` \| null | `inductive` (gradient-free at eval time) \| `transductive` (requires gradients on eval set) |
| `extra_input_modality` | str \| null | present in the schema, unused in this fixture |
| `supervision_regime` | `SupervisionRegime` \| null | `zero_shot` \| `few_shot` \| `full` \| `other` — unused in this fixture |
| `finetuning_strategy` | `FinetuningStrategy` \| null | `linear_probe` \| `mlp_probe` \| `gradual_unfreezing` \| `full_finetuning` \| `other` — unused in this fixture |

### `task_scores`

One row per `task_submissions` row, 1:1 (`task_submission_id` is unique):
the aggregated-over-seeds score.

| Field | Type | Notes |
|---|---|---|
| `task_submission_id` | UUID | |
| `n_seeds` | int | how many seeds were averaged (5 in the fixture) |
| `primary_metric_mean`, `primary_metric_sem` | float, float \| null | scalar columns used for fast leaderboard `ORDER BY` |
| `metrics` | JSON dict \| null | full per-metric breakdown, e.g. `{"r2": {"mean": ..., "sem": ...}}` — omitted in this fixture, populated by `TS1Scorer.score` for real submissions |

`primary_metric_mean`/`sem` correspond to whichever metric `Task.primary_metric`
names for that task (see below) — e.g. for `ts1-reward` (`bacc`), the fixture's
`0.85 ± 0.02` is a balanced-accuracy score, not r².

### The static `tasks` table (seeded separately)

Not part of `ts1_baseline.json` — the fixture only references `task_id`
strings. The lookup rows themselves come from `tests/fixtures/load.py::seed_tasks`
(mirroring the real Alembic seed migration), and must be loaded before
`task_submissions` can satisfy its FK. All 8 TS1 tasks:

| `task_id` | `task_type` | `primary_metric` |
|---|---|---|
| `ts1-choice` | `categorical` | `bacc` |
| `ts1-reward` | `categorical` | `bacc` |
| `ts1-stimulus_contrast` | `categorical` | `bacc` |
| `ts1-licking_rate` | `point_process` | `cohens_r2` |
| `ts1-whisker_motion_energy` | `continuous` | `r2` |
| `ts1-wheel_speed` | `continuous` | `r2` |
| `ts1-right_paw_speed` | `continuous` | `r2` |
| `ts1-left_paw_speed` | `continuous` | `r2` |

(`seed_tasks` also seeds 2 `ts2-*` and 1 `ts3-*` rows for the other task
suites — irrelevant to TS1 but sharing the same table.)

## How tests use it

- `tests/conftest.py::seeded_client` calls `load_fixture(session, FIXTURE_PATH)`
  after `seed_tasks`, giving a test client backed by one fully-populated
  submission.
- `tests/test_api.py` hardcodes the fixture's UUIDs (`TEAM_ID`, `USER_ID`,
  `MODEL_ID`, `SUB_ID`) and asserts against known values from the JSON — e.g.
  `scores["ts1-reward"]["mean"] == 0.85` and `len(task_submissions) == 8`.
  If you edit `ts1_baseline.json`, update those assertions too.
- `tests/test_scoring.py` uses `sample.zip` (not this JSON) directly against
  `TS1Scorer`, independent of the DB layer.