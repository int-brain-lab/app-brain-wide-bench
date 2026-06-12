# brain-wide-bench

Prototype neural-model benchmarking platform. Users upload a zip of `safetensors`
predictions; a Celery worker scores them against a private ground-truth oracle and
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
  database.py              async SQLAlchemy engine/session
  models.py                User / Submission / SubmissionUser
  storage.py               S3 presign + GT/submission download (local-dir fallback)
  routers/                 submissions, leaderboard, users
  schemas/                 Pydantic request/response models
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
local directory it is used directly (no S3 needed). Local dev copy:
`~/Documents/datadisk/brain-wide-bench/ts1`.

## Full stack

`docker compose up --build` starts Postgres, Redis, the web service (port 80) and a
Celery worker. Migrations run with `alembic upgrade head`. Deploy to EC2 happens via
`.github/workflows/deploy.yml` on push to `main`.

## Adding a task

Implement a `BaseScorer` subclass in `app/scoring/<task>.py` and register it in
`app/scoring/__init__.py::_SCORERS`. The presign endpoint and Celery task need no
changes; unsupported tasks are rejected with HTTP 400.
```
