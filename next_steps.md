# Next steps

Snapshot after wiring the new static frontend to the real backend/DB and getting
`brainwidebench.iblcore.org` back to a healthy, seeded-for-demo state.

## Frontend

- **`frontend/submit.html`** is still the old pre-redesign page: it uses the legacy
  `frontend/app.js` / `frontend/style.css` and POSTs a body that doesn't match the
  current `POST /api/submissions/presign` schema (`team_id`, `model_id`, `label`,
  `task_ids`, `is_public`). Submitting is currently broken. Needs a rewrite onto the
  new nav/css and the current schema.
- **`frontend/dashboard.html`** is a static stub — nav + task-suite cards only, no
  live data. Natural next step: a "my models" / "my submissions" view backed by
  `GET /api/users/me/models`.
- **`frontend/submission_details.html`** is unreferenced from any nav link and has a
  bug: its HTML uses `id="submission-title"` but `model_details.js` (which it loads)
  looks for `id="model-title"`. Either fix the ids and link it in, or remove it.
- `GET /api/teams`, `GET /api/tasks`, `GET /api/models` (list) are referenced in
  `frontend/js/api.js`'s mock-data path table but have no real backend implementation
  and no page calls them yet — build only once a page actually needs them (e.g. a
  rebuilt `submit.html` will need team/task pickers).

## Backend / CI

- **CI (`test` workflow) has never passed** — `uv sync` fails because `ibl-benchmark`
  is consumed as an editable path dependency (`../ibl-benchmark`) that doesn't exist
  on GitHub Actions runners. Needs `ibl-benchmark` published somewhere CI can install
  it from (PyPI, a private index, or vendoring/git-submodule it into CI's checkout).
- **Alembic migrations are not exercised by tests** — `tests/conftest.py` builds the
  schema via `SQLModel.metadata.create_all()` on SQLite, so a broken migration (as
  `0001_initial.py` was, until `474a68a`) passes CI silently. Worth adding a test (or
  a CI step) that runs `alembic upgrade head` against a real Postgres container.
- **Nothing stops a deploy shipping stub authentication.** `frontend/js/api/client.js` has
  `const DEV_MODE = true`, which signs the browser in against a localStorage flag rather than
  Auth0; deployed as-is, anyone is let through as the API's dev user. It has to be `false` to
  deploy and nothing enforces that. One line in `deploy.sh`, between `git pull` and
  `docker compose up -d --build`, so a wrong flag costs no rebuild:

  ```bash
  grep -q '^const DEV_MODE = false;' frontend/js/api/client.js || {
    echo "DEV_MODE is on in client.js — refusing to deploy stub authentication."
    exit 1
  }
  ```

  Worth doing alongside the other changes to this script rather than on its own.
- **`scripts/deploy.sh`'s executable bit is fragile.** It has been lost by accidental
  commits at least twice. Because GitHub Actions invokes the *on-disk* copy on the
  EC2 box directly via SSM (not `bash scripts/deploy.sh`), losing +x bricks deploys in
  a way that can't self-heal — the script can't run itself to `git pull` the fix.
  Consider changing the SSM command to `bash /srv/app-brain-wide-bench/scripts/deploy.sh`
  so this class of bug stops being fatal.
- **nginx's upstream-DNS-refresh fix is unreliable.** `nginx/nginx.conf`'s
  `resolver ... valid=5s` + variable `proxy_pass` is meant to avoid 502s after a
  `docker compose up -d --build` recreates the `web` container with a new IP, but it
  didn't refresh in a reasonable window during the last deploy — needed a manual
  `docker compose restart nginx`. Consider adding an automatic nginx restart to
  `scripts/deploy.sh` after `docker compose up -d --build`.

## Submission uploads and the worker

Both have their own walkthrough; these are the headlines.

- **The worker's scratch space shares a filesystem with Postgres** —
  `docs/worker_disk_plan_todo.md`. `score_submission` holds the zip and its extraction at
  once, so one 10 GB submission peaks at ~20 GB plus the ground-truth tree, and the `worker`
  service has no `volumes:` key — every byte lands in the container overlay on the host root
  volume, where `postgres_data` also lives. A job that fills it takes the database with it.
  Nothing is measured yet; the doc lists the fixes in order of value.
- **A submission's file has several ways to stall with no way back** —
  `docs/upload_lifecycle_todo.md`, eleven decisions, each useful alone. The sharp ones: a row
  reaches `validating` and stays there forever if the worker is killed, the task hangs or the
  broker message is lost, and nothing reaps it; an `unchecked` submission cannot be re-checked
  without a full re-upload even though its file is still in S3 and probably fine; and picking
  a *different* file of the *same size* resumes the old multipart upload, which is silently
  wrong rather than merely broken.

## Data

- Production DB currently holds **demo/placeholder data** (4 models across 2 teams,
  seeded for a stakeholder preview) — not real submissions. Swap in real evaluated
  models before sharing the leaderboard as anything but a prototype, or add a visible
  "demo data" banner in the meantime.

## Auth / deferred features

- ORCID social login is deferred — requires upgrading the Auth0 tenant to a Developer
  plan.
- `ibl-benchmark` on the server (`/srv/ibl-benchmark`) is placed via manual `rsync`,
  not a real dependency install — repeat after every `ibl-benchmark` change until it's
  published and pinned in `pyproject.toml` (same underlying issue as the CI gap above).
