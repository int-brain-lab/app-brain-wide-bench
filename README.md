# brain-wide-bench

Neural-model benchmarking platform. Users upload a zip of `safetensors`
predictions; a Celery worker scores them against a ground-truth oracle and
publishes results to a public leaderboard.

This directory is the git repository root. The `ibl-benchmark/` package (which
provides `core.scoring.ts1_scoring`) lives **alongside** this repo as a sibling
directory and is consumed as an editable dependency at `../ibl-benchmark`.

## Layout

```
app/                       FastAPI backend (importable as the `app` package)
  main.py                  app factory: CORS + routers + /health
  config.py                pydantic-settings from env
  auth.py                  Auth0 JWT validation (+ dev stub) → get_current_user
  database.py              async SQLAlchemy engine/session (SQLModel + psycopg3)
  models.py                SQLModel ORM models: User / Submission / SubmissionUser
  storage.py               S3 presign + GT/submission download (local-dir fallback)
  routers/                 submissions, leaderboard, users
  schemas/                 Pydantic request/response models (non-table shapes)
  scoring/                 pure scorers (BaseScorer ABC, TS1Scorer, get_scorer)
  worker.py                Celery app (Redis broker)
  tasks/score.py           Celery glue: S3 → scorer → DB
alembic/                   migrations (0001_initial)
tests/                     scoring unit tests + sample.zip fixture
frontend/                  vanilla JS SPA (index / submit / dashboard)
Dockerfile, docker-compose.yml, .github/workflows/   deployment
../ibl-benchmark/          editable dependency (sibling, outside this repo)
```

## Run locally

```bash
uv sync
uv run pytest                       # scoring tests (uses local GT if present)

# API in dev mode (no Auth0, no Postgres needed for read endpoints)
cp .env.example .env                # set AUTH0_DOMAIN=dev for the auth stub
uv run uvicorn app.main:app --reload --port 8080
```

Serve the frontend with any static server (e.g. `python -m http.server` in
`frontend/`). Leave `app.js`'s `auth0ClientId` as the placeholder to run the UI in
dev mode against the stub backend.

### Ground truth

The scorer reads ground truth from `S3_GT_PREFIX`. If that points at an existing
local directory it is used directly (no S3 needed).

## Full stack

`docker compose up --build` starts Postgres, Redis, the web service (port 80) and a
Celery worker. Migrations run with `alembic upgrade head`. Deploy to EC2 happens via
`.github/workflows/deploy.yml` on push to `main`.

The production instance runs at `http://brainwidebench.iblcore.org` (EC2 t3.small,
us-east-1). Full deployment instructions, resource IDs, and operational notes are in
[`iblsre/brain-wide-bench/aws_deploy.md`](https://github.com/int-brain-lab/iblsre/blob/main/brain-wide-bench/aws_deploy.md).

## Submission format

### 1. Zip layout

The upload is a zip that extracts to:

```
<label>/
  <task>/
    <recording_id>/
      seed_42.safetensors
      seed_43.safetensors
      …
```

`label` is a free-form model name (e.g. `mlp-baseline`). `task` is a flat task id
(e.g. `ts1-licking_rate`). `recording_id` is the session UUID. Multiple seeds are
expected — the scorer averages over them and reports the standard error of the mean.

The scorer reads `label`, `task`, `recording_id`, and `seed` from the **safetensors
metadata**, so the directory layout is just for human readability and does not need to
be perfectly consistent with the file contents.

### 2. Prediction files (`.safetensors`)

Each file carries string metadata and prediction tensors. The tensor layout depends on
the task type:

**Timestep-level tasks** (e.g. `ts1-licking_rate`, `ts1-whisker_motion_energy`):

| Tensor | Shape | dtype |
|--------|-------|-------|
| `predictions` | `(N_trials, T, D)` | float32 |
| `trial_id` | `(N_trials,)` | int64 |
| `timestamps` | `(N_trials, T)` | float32 |

**Trial-level classification tasks** (e.g. `ts1-reward`):

| Tensor | Shape | dtype |
|--------|-------|-------|
| `predictions` | `(N_trials, 1, n_classes)` — raw logits | float32 |
| `trial_id` | `(N_trials,)` | int64 |

Predictions are aligned to ground truth by `trial_id` intersection, so partial
submissions (missing trials or recordings) are handled gracefully — only matched trials
are scored.

## Adding a task

Implement a `BaseScorer` subclass in `app/scoring/<task>.py` and register it in
`app/scoring/__init__.py::_SCORERS`. The presign endpoint and Celery task need no
changes; unsupported tasks are rejected with HTTP 400.
```
