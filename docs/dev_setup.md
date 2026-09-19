# Dev setup

Four stages. Each one adds a single capability and the setup it needs, and each is a working
app on its own — stop at the stage your task actually needs.

| Stage | Adds | Containers | What it lets you exercise |
|---|---|---|---|
| 1. Browse | a database with data in it | postgres | every read view — leaderboard, models, teams, submissions. Auth is stubbed |
| 2. Sign in | a real Auth0 tenant | postgres | callback URLs, code exchange, JWT verification, the custom claims |
| 3. Validate | a Celery worker | + redis | creating a submission, and everything validation and scoring then do to it |
| 4. Upload | an object store | + minio | the transfer itself — real multipart, real ETags, real CORS |

Stages 2 and 3 are independent of each other: the worker runs perfectly well against stubbed
auth, and you can sign in for real with no worker. Stage 4 needs stage 3.

Each stage says exactly which `.env.local` fields it changes. Appendix A is the whole file
with every stage's block in it, if you would rather read the destination than the diff.

## Before you start

```bash
uv sync
```

Then pick a container engine, once per shell. Every command below uses it:

```bash
export CE=podman        # or: export CE=docker
```

The two are drop-in for everything here. They part company only at `compose` — `docker compose`
is built in, `podman compose` needs an external provider — which is why the standalone `run`
commands below, and not `docker-compose.yml`, are the local path. That file describes the same
services for the deploy.

The frontend needs no build step. `app/main.py` mounts `frontend/` — the source tree, not
`dist/` — at `/`, so one process serves both halves same-origin and a frontend edit is one
refresh away. `npm run build` is for checking the bundle before a deploy, not for this loop.

---

# Stage 1 — the app, with data, no auth

Postgres, the schema, a fixture, and the API. Authentication is stubbed: every request is
resolved to one dev user without a token ever being involved.

## 1.1 Postgres

```bash
$CE volume create bwb-pgdata

$CE run -d --name bwb-postgres -p 5434:5432 \
  -e POSTGRES_DB=brainwidebench \
  -e POSTGRES_USER=brainwidebench \
  -e POSTGRES_PASSWORD=changeme \
  -v bwb-pgdata:/var/lib/postgresql/data \
  postgres:16
```

Port 5434 on the host, deliberately — it keeps this clear of a system Postgres on 5432.

The volume survives `$CE rm bwb-postgres`, so the container is disposable and the data is not.
`$CE volume rm bwb-pgdata` is how you start over.

## 1.2 `.env.local`

```bash
cp .env.example .env.local
```

`.env.local` is gitignored, and is the only env file you need — `.env.example` is the only one
in the repository, and `.env` belongs to the containerised deploy (`env_file: .env` in
`docker-compose.yml`), not to a host-side run.

Change four fields:

| Field | `.env.example` ships | Set it to | Why |
|---|---|---|---|
| `DATABASE_URL` | `…@db:5432/…` | `…@localhost:5434/…` | `db` is a compose service name and does not resolve from the host |
| `AUTH0_DOMAIN` | `your-tenant.us.auth0.com` | `dev` | The literal string `dev` switches JWT verification off |
| `S3_STUB` | `false` | `true` | Nothing in this stage should reach for a bucket |
| `CORS_ORIGINS` | `*` | leave it | Legal only while `AUTH0_DOMAIN=dev`; stage 2 has to change it |

So the file reads, in the part that matters:

```
DATABASE_URL=postgresql+psycopg://brainwidebench:changeme@localhost:5434/brainwidebench
AUTH0_DOMAIN=dev
S3_STUB=true
CORS_ORIGINS=*
```

`Settings` reads `.env` and nothing else (`app/config.py`), so `.env.local` takes effect
through `uv run --env-file .env.local`: that promotes its contents to real environment
variables, which pydantic-settings ranks above any file. **Every command in this document is
prefixed that way, and one that is not will quietly use the wrong database.**

`--env-file` fills in variables that are *unset*. It does not override one already exported in
your shell, and the seed scripts' docstrings invite you to export exactly these. Before a
session that is behaving strangely:

```bash
env | grep -E 'AUTH0|DATABASE_URL|REDIS|S3_'    # should print nothing
```

## 1.3 The schema

```bash
uv run --env-file .env.local alembic upgrade head
```

That also seeds the `tasks` lookup table. Nothing else creates it — the fixture loader
deliberately builds no tables of its own, because a second definition of the schema drifts
from the migrations.

## 1.4 Data

Two ways in. The first works in any clone; the second needs the prediction and ground-truth
files, and gives you the real baselines.

### Option A — the committed test fixture

```bash
uv run --env-file .env.local python scripts/load_fixture_data.py tests/fixtures/api_tests.json
```

`tests/fixtures/api_tests.json` is the fixture the API tests run against: three teams, three
users, three models, five submissions across a range of statuses and visibilities. It is 12 KB,
it is in the repository, and it loads into an empty database with no dependencies at all.

Its one limitation is ownership. The three users in it are invented, and none of them is the
stub — dev mode authenticates every request as `DEV_SUB` (`app/auth.py`), and your first
request creates *that* row, a fourth user belonging to no team. Everything public is therefore
visible and nothing is yours: the leaderboard, the model pages and the team pages are all
populated, while the dashboard is empty.

Open the app once so the stub user exists, then:

```bash
uv run --env-file .env.local python scripts/set_user_role.py dev@brainwidebench.org admin
```

`admin` passes every membership and ownership check, so every team's models, submissions and
member list become readable and writable, including the fields withheld from outsiders.

It does **not** fill the submission form's model dropdown, which answers from real team
membership rather than from the role. If you are heading for stage 3, create a team through
the UI — that is a two-field form, and it makes you its owner.

### Option B — the real baselines, scored from prediction files

If you have the baseline predictions, the ground truth and `bwb_models.json`, you can build the
baselines fixture yourself. It is the better stage-1 database: thirteen models, sixteen
submissions, real numbers, and — unlike option A — every row owned by the dev stub user, so the
whole app is yours as soon as it loads.

The script wants one directory holding three things:

```
<data-root>/bwb_models.json                                                       what exists
<data-root>/baselines/<label>/<flat-task>/[<recording_id>/]seed_*.safetensors     the numbers
<data-root>/ground_truth/<flat-task>/[<recording_id>/]ground_truth.safetensors    scored against
```

`bwb_models.json` is the source of truth for what exists — models, submissions, labels and each
task entry's methodology. The prediction files decide only the scores. A submission's directory
under `baselines/` is named after its label, and one the metadata declares but the disk does not
hold is reported and skipped rather than being an error.

`--data-root` moves all three at once; `--pred-root`, `--gt-root` and `--metadata` move one each.
The default is `~/Downloads/new_again_brainwidebench`.

```bash
uv run python scripts/make_baselines.py --data-root /path/to/data --public
uv run --env-file .env.local python scripts/load_fixture_data.py \
    tests/fixtures/2026_09_16_baselines.json
```

The first command touches no database, no S3 and no Celery — it scores files and writes JSON —
so it needs no `--env-file`. `uv sync` already installed torch and safetensors, so there is
nothing further to install. It rewrites the fixture after each submission, so an interrupt keeps
what has already scored; `--resume` then picks up only what is new, and `--dry-run` reports
without writing.

`--public` publishes every submission, which is what you want for looking at a leaderboard.

`docs/baselines_fixture.md` covers the rest: what the metadata decides, how suites are chosen,
and the `--owner-id` form used for a deployment.

### Either way

The loader refuses a database that already holds teams, users, models or submissions, and
refuses one that is not at the migration head. Both are checks against loading a fixture over
data you meant to keep. `--append` lifts the first, for a fixture whose rows are genuinely not
in the database yet — every table loads in one transaction, so a primary-key collision writes
nothing and names the constraint it hit.

### Wiping the database

> [!WARNING]
> **This destroys every row and every table in the database — fixtures, your teams, your
> submissions, all of it, with no confirmation and no undo.** It is also the only clean way
> to load a different fixture, since the loader refuses a database that already holds data.
> **You must run `alembic upgrade head` again afterwards**, or the next command will fail
> against a database with no schema in it.

```bash
$CE exec -i bwb-postgres psql -U brainwidebench -d brainwidebench \
    -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'

uv run --env-file .env.local alembic upgrade head
```

Then load a fixture again, from 1.4.

Dropping the schema rather than the tables is deliberate. The tables are not the only thing
the migrations create — `0001_initial` also creates a dozen Postgres enum types, and those are
not schema-qualified away by dropping tables. A wipe that leaves them behind makes the next
`upgrade head` fail with `type "submissionstatus" already exists`. `DROP SCHEMA … CASCADE`
takes the types with it.

For the same reason, do not reach for `alembic downgrade base`. Its `downgrade` functions drop
the tables and not the enum types, so it lands you in exactly that state.

Nothing here touches the container or the volume, so Postgres keeps running and the connection
string does not change. If you want to go further than the schema — a corrupted volume, a
version bump, a genuinely fresh start — remove the lot and rebuild from 1.1:

```bash
$CE rm -f bwb-postgres
$CE volume rm bwb-pgdata
```

## 1.5 Run it

```bash
uv run --env-file .env.local uvicorn app.main:app --reload --port 8000
```

<http://localhost:8000> — the API and the frontend, same origin, one process.

Run it in the foreground. An unhandled exception prints its whole traceback to the terminal,
which is the difference between a diagnosis and Starlette's opaque 21-byte
`Internal Server Error`.

### Check

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8000/health           # 200
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8000/api/leaderboard  # 200
curl -s http://localhost:8000/api/users/me | head -c 200                        # the stub user
```

That third one is the stage-1 signature: a full user object with no token presented at all.

### What does not work yet

Creating a submission. The form uploads, and validation runs in a Celery worker that is not
running — the submission would sit at `validating` forever. That is stage 3.

---

# Stage 2 — a real Auth0 tenant

Stage 1 never exercises a line of `app/auth.py`. This does, and it needs no code change:
`frontend/js/api.js` derives `redirect_uri` from `window.location.origin`, so the committed
file works on localhost and in production alike. Only Auth0's allowlist has to know about both.

| | Stage 1 (`AUTH0_DOMAIN=dev`) | Stage 2 (real tenant) |
|---|---|---|
| UI, routing, business logic | yes | yes |
| Callback URLs, code exchange | no | yes |
| JWT signature and audience | no | yes |
| Custom claims (the Login Action) | no | yes |
| Signed in as | one stub user (`app.auth.DEV_SUB`) | your real Google identity |

## 2.1 Get the tenant details

The tenant domain and the SPA application's client ID are **not in this repository**. They live
with the rest of the deployment notes on the private IBL dev site:
[`ibldevtools/00_dev_site/deployments/brain_wide_bench.md`](https://github.com/int-brain-lab/ibldevtools/blob/main/00_dev_site/deployments/brain_wide_bench.md).
Read that page for which tenant to use and where the client ID is; ask if you cannot reach it.

The client ID is not a secret — a SPA is a public client, using PKCE with no client secret —
and the frontend reads it from `GET /api/meta/auth-config` rather than hardcoding it, which is
why changing tenants is an env var change and not a rebuild.

## 2.2 Register localhost with Auth0

Applications → the SPA app → Settings. Append to the existing production values,
comma-separated:

| Field | Add |
|---|---|
| Allowed Callback URLs | `http://localhost:8000/index.html` |
| Allowed Logout URLs | `http://localhost:8000` |
| Allowed Web Origins | `http://localhost:8000` |

`http://` is fine here: localhost is Auth0's documented exception to the HTTPS-only rule, and
browsers treat it as a secure context, so the SDK's `Secure` cookies still work.

Auth0 matches these as exact strings, so the port is part of the entry.
`http://localhost:8000/index.html` and `http://localhost/index.html` are unrelated as far as it
is concerned — register only what you actually use.

While you are in there, confirm two settings a SPA cannot work without. Application Type must
be `Single Page Application`, and under Advanced Settings → Endpoint Authentication, Token
Endpoint Authentication Method must be `None`. The second is the one Auth0 actually enforces,
and it does not reliably follow a change to the first: get it wrong and `POST /oauth/token`
answers `401 {"error":"access_denied","error_description":"Unauthorized"}`, because Auth0 is
demanding a client secret that a browser app has nowhere to keep.

Actions are tenant-wide rather than per-application, so the Login Action that supplies the
namespaced `email` and `name` claims (`_CLAIM_NS` in `app/auth.py`) fires for localhost sign-ins
too. Nothing extra to configure — and equally, an Action added while debugging locally is
immediately live for production users.

## 2.3 `.env.local`

| Field | Stage 1 had | Set it to | Why |
|---|---|---|---|
| `AUTH0_DOMAIN` | `dev` | the tenant domain | Anything other than `dev` or empty turns `dev_mode` off |
| `AUTH0_CLIENT_ID` | empty | the SPA client ID | Served to the frontend by `/api/meta/auth-config` |
| `AUTH0_AUDIENCE` | `https://api.brainwidebench.org` | the tenant's API identifier | Checked against the token's `aud` |
| `CORS_ORIGINS` | `*` | `http://localhost:8000` | A wildcard is refused outside dev mode |

```
AUTH0_DOMAIN=<tenant>.us.auth0.com
AUTH0_CLIENT_ID=<the SPA client id>
AUTH0_AUDIENCE=https://api.brainwidebench.org
CORS_ORIGINS=http://localhost:8000
```

`CORS_ORIGINS` is the one that is easy to miss, because leaving it out is not a missing value —
it is the wildcard inherited from `.env.example`. `Settings` refuses `CORS_ORIGINS=*` outside
dev mode and raises at import, so the API exits with
`CORS_ORIGINS=* is not allowed outside dev mode` before it serves anything. `CORSMiddleware`
runs with `allow_credentials=True`, and Starlette answers that combination by reflecting back
whatever `Origin` it was sent — a wildcard there really means "every origin, with credentials".
Stage 2 is same-origin, so one entry covers it.

`AUTH0_AUDIENCE` is the identifier of the API registered in that tenant, which is not
necessarily the value `.env.example` ships. If sign-in succeeds and API calls then 401, this is
the first thing to compare: decode the token and check its `aud` against Auth0 → APIs.

The stale-export trap from stage 1 bites hardest here. An `export AUTH0_DOMAIN=dev` left over
from a stage-1 session silently beats `.env.local`, and the API runs stubbed while the browser
signs in for real — the symptom is being handed the dev user after a successful Google login.
The environment is fixed when the process launches, so `--reload` will not pick up a fix:

```bash
unset AUTH0_DOMAIN AUTH0_AUDIENCE AUTH0_CLIENT_ID DATABASE_URL REDIS_URL
```

Then restart, or use a fresh terminal.

## 2.4 Your data changed hands

You are now a real `sub`, not the stub, so nothing a stage-1 fixture loaded belongs to you. A
fresh sign-in creates your `User` row and puts you on no teams, which means `/me/models` is
empty and the submission form's dropdown is blank.

Either create a team through the UI — the quickest path, and it makes you its owner — or
rebuild the fixture against your account:

```bash
# the id your sign-in was given
psql -h localhost -p 5434 -U brainwidebench -c \
  "select id, email from users order by created_at desc limit 5"

uv run python scripts/make_baselines.py --public --owner-id <that uuid>
uv run --env-file .env.local python scripts/load_fixture_data.py \
    tests/fixtures/2026_09_16_baselines.json --append
```

With `--owner-id` the fixture writes no user row at all — it only references one — so nothing
can collide with the row Auth0 already created. `--append` is needed because a signed-in
account is already data, which the loader otherwise refuses. See "Who owns the rows" in
`baselines_fixture.md` for why pinning a real account's `sub` instead is a trap.

## 2.5 Check

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8000/health           # 200
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8000/api/leaderboard  # 200
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8000/api/users/me     # 401
```

The 401 is the point — it is the same request that returned a user object in stage 1, and it
proves JWT verification is switched on against the real tenant. A 500 there would mean
`AUTH0_DOMAIN` never reached the process.

In the browser, a healthy sign-in leaves an `@@auth0spajs@@::…` key in localStorage. Its absence
means the token is not surviving navigation.

---

# Stage 3 — the worker, and local validation

Creating a submission is the first thing that needs more than the API. Validation runs in a
Celery worker over a Redis broker, and the form blocks on its verdict, so both are required
from here on.

This stage still skips the upload: the browser pretends to transfer the file, and the worker
validates a directory you point it at instead. That is enough to exercise every status
transition, the whole validator, and scoring.

## 3.1 Redis

```bash
$CE run -d --name bwb-redis -p 6379:6379 redis:7-alpine
```

No password locally. `docker-compose.yml` sets `requirepass` from `REDIS_PASSWORD` for the
deploy, where an unauthenticated Celery broker would be a real problem.

## 3.2 `.env.local`

| Field | Add | Why |
|---|---|---|
| `REDIS_URL` | `redis://localhost:6379/0` | `.env.example` names the compose hostname `redis` |

```
REDIS_URL=redis://localhost:6379/0
```

## 3.3 Something to validate

The validator only ever accepts a *pair*: the predictions, and the ground truth their
`trial_id`s are checked against. Without the multi-GB dataset, generate a matching pair:

```bash
uv run python -c "
from pathlib import Path
from tests.fixtures.submissions import write_submission
print(write_submission(Path.home() / 'bwb-dev-fixture'))
"
```

It prints the two directories it wrote — predictions and ground truth. One task, one recording,
three seeds. Deleting a metadata key from one of the files is how you see a failure instead.

If you did stage 1 option B, the `ground_truth/` directory you already have works too, and is
the one to use for validating real predictions.

## 3.4 `.env.local`

| Field | Set to | Why |
|---|---|---|
| `S3_STUB` | `true` | The upload is skipped; no object store is contacted at all |
| `STUB_SUBMISSION_DIR` | the predictions directory | What the worker validates, since a skipped upload left nothing to read back |
| `S3_GT_PREFIX` | the ground-truth directory | Used as-is when it names an existing directory |

```
S3_STUB=true
STUB_SUBMISSION_DIR=/home/<you>/bwb-dev-fixture/pred
S3_GT_PREFIX=/home/<you>/bwb-dev-fixture/gt
```

**Paste the printed paths verbatim.** `pydantic-settings` expands neither `~` nor `$HOME`, and
a path that does not resolve goes unnoticed until the worker runs and the submission lands on
`unchecked`.

Note that `S3_GT_PREFIX` means something different in production: there it is a bucket prefix
holding one directory per suite (`ground-truth/ts1/…`), not a single suite's prefix. A local
path is expected flat-task-rooted instead — `download_ground_truth` is where the two cases part.

## 3.5 Make the zip

```bash
cd ~/bwb-dev-fixture/pred && zip -r ~/bwb-dev-fixture/submission.zip .
```

**It has to be a zip of `STUB_SUBMISSION_DIR`, not any zip.** The two halves of the flow read
different things here: prevalidation reads the archive's own directory listing in the browser,
so the detected tasks are your real file's, while the worker reads `STUB_SUBMISSION_DIR`
because a skipped upload left nothing else to read. `submit` then checks the tasks you
configured against the tasks validation found, and refuses with a 400 if they differ. Zipping
the stand-in is what makes the two agree.

## 3.6 Run both halves

Two terminals:

```bash
uv run --env-file .env.local uvicorn app.main:app --reload --port 8000
uv run --env-file .env.local celery -A app.worker worker --loglevel=info
```

Both read `--env-file` at process start, so a settings change means restarting both — not
just the one you edited for.

## 3.7 Check

Create a submission at `/html/submissions/submission_create.html`. Expected, in order:

1. picking the file locks `Deterministic` above it and fills the detected-task badges within a
   second — that is prevalidation, and nothing has been sent yet
2. the tasks panel unlocks, and "Upload file for validation" appears
3. pressing it locks Delete, and the file panel says "Checking the file…"
4. the file panel turns green, the visibility panel opens, and the submit button enables
5. submitting redirects to the submission, status `scoring`

The worker log carries one line per validation, plus every finding's internal detail.

To exercise the failure paths rather than the happy one, `scripts/make_bad_submissions.py`
writes one deliberately broken zip per error code, and checks its own work by validating each
one after writing it. `docs/validation_fixtures.md` has the table of what each produces and
where it surfaces.

---

# Stage 4 — MinIO, and the real upload

Stage 3 never transfers a byte. This replaces the stub with a local S3, so the browser really
does a multipart upload, the ETags are real, CORS is real, and the file that gets validated is
the one you picked.

## 4.1 MinIO

```bash
$CE volume create bwb-minio

$CE run -d --name bwb-minio -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  -v bwb-minio:/data \
  minio/minio server /data --console-address ":9001"

$CE run --rm --network=host --entrypoint sh minio/mc -c \
  "mc alias set local http://localhost:9000 minioadmin minioadmin &&
   mc mb --ignore-existing local/brainwidebench-submissions"
```

The bucket has to exist before the first presigned PUT — the MinIO server image creates none of
its own.

Published on 9000 and addressed as `localhost:9000` by both the API and the browser: a
presigned URL is signed for one host, and the two sides must agree on which.

`--network=host` works on Linux with either engine. On Docker Desktop it does not reach the
host, so run the two `mc` lines against the container instead:
`docker run --rm --link bwb-minio --entrypoint sh minio/mc -c "mc alias set local http://bwb-minio:9000 …"`.

## 4.2 `.env.local`

| Field | Set to | Why |
|---|---|---|
| `S3_STUB` | `false` | Must be off before `S3_ENDPOINT_URL` is reached at all |
| `S3_ENDPOINT_URL` | `http://localhost:9000` | Empty means real AWS |
| `S3_BUCKET` | `brainwidebench-submissions` | The bucket created above |
| `AWS_ACCESS_KEY_ID` | `minioadmin` | MinIO's root credentials |
| `AWS_SECRET_ACCESS_KEY` | `minioadmin` | |

```
S3_STUB=false
S3_ENDPOINT_URL=http://localhost:9000
S3_BUCKET=brainwidebench-submissions
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
```

`STUB_SUBMISSION_DIR` is now ignored, and can stay. `S3_GT_PREFIX` stays exactly as stage 3 left
it: ground truth remains local in both modes, because `download_ground_truth` returns
`s3_gt_prefix` as-is when it names a directory, so there is nothing to upload to MinIO.

Restart uvicorn and the worker — `--env-file` is read at startup.

## 4.3 Check

The same five steps as stage 3, with the same zip. The difference is that the file panel now
sits on "Checking the file…" for as long as the transfer takes, and what comes back is a
verdict on your actual archive.

Console: <http://localhost:9001>, same credentials. It is the quickest way to see whether parts
arrived.

**A one-part upload proves little.** The fixture zip is about a kilobyte, so multipart's retry
and resume paths never fire. Padding a copy to 200 MB gives four parts and a corrupt archive:
the transfer is exercised, then validation fails. They are two separate things to test.

---

# Appendix A — the whole `.env.local`

Every stage's block, cumulative. Delete from the bottom to walk back a stage.

```bash
# ── Stage 1: database and stubbed auth ──────────────────────────────────────
DATABASE_URL=postgresql+psycopg://brainwidebench:changeme@localhost:5434/brainwidebench
AUTH0_DOMAIN=dev
AUTH0_AUDIENCE=https://api.brainwidebench.org
CORS_ORIGINS=*
S3_STUB=true

# ── Stage 2: a real Auth0 tenant (replaces the two AUTH0_ lines above) ──────
# AUTH0_DOMAIN=<tenant>.us.auth0.com
# AUTH0_CLIENT_ID=<the SPA client id>
# AUTH0_AUDIENCE=<the tenant's API identifier>
# CORS_ORIGINS=http://localhost:8000

# ── Stage 3: the worker, validating a local directory ───────────────────────
# REDIS_URL=redis://localhost:6379/0
# STUB_SUBMISSION_DIR=/home/<you>/bwb-dev-fixture/pred
# S3_GT_PREFIX=/home/<you>/bwb-dev-fixture/gt

# ── Stage 4: MinIO, and a real upload ───────────────────────────────────────
# S3_STUB=false
# S3_ENDPOINT_URL=http://localhost:9000
# S3_BUCKET=brainwidebench-submissions
# AWS_ACCESS_KEY_ID=minioadmin
# AWS_SECRET_ACCESS_KEY=minioadmin
```

# Appendix B — when it breaks

## Any stage

| Symptom | Cause |
|---|---|
| Connection refused on the database | The container is stopped. `$CE start bwb-postgres`. |
| A setting was changed but nothing behaves differently | `--env-file` is read at process start. Restart uvicorn, and the worker too. |
| A setting is ignored however often you restart | Something is exported in that shell. `env \| grep -E 'AUTH0\|DATABASE_URL\|REDIS\|S3_'` should print nothing. |
| `500`, 21 bytes of `text/plain` | Starlette's unhandled-exception response. The traceback is in the terminal running uvicorn. |

## Stage 1

| Symptom | Cause |
|---|---|
| `401` on every request | The API is not in dev mode. `AUTH0_DOMAIN=dev`. |
| The loader refuses to run | The database already holds rows, or is not at the migration head. `--append`, or wipe it — see "Wiping the database" in 1.4. |
| Dashboard is empty, leaderboard is not | Expected with `api_tests.json` — the stub user is on no team. See stage 1.4 option A. |
| "You have no models yet" in the submission form | The dropdown answers from team membership, not from the `admin` role. Create a team in the UI. |
| `make_baselines.py` lists submissions and scores none | The metadata declares them, the disk does not hold them. Check `--pred-root` and the per-label directory names. |

## Stage 2

| Symptom | Cause |
|---|---|
| `Callback URL mismatch` | The exact `origin + /index.html` string is not registered. Ports and trailing slashes count. |
| `401` from `POST /oauth/token`, body `access_denied` / `Unauthorized` | Token Endpoint Authentication Method is not `None`. |
| `invalid_grant` from `/oauth/token` | The `?code=` was already spent. Codes are single-use and last ~30s, and `api.js` only strips it from the URL after a *successful* exchange — so reloading the callback URL always fails this way. Start again from a clean `/index.html`. |
| `Could not get an access token: Timeout` | The silent-renewal iframe got an Auth0 error page instead of a callback, so nothing ever posted back. Almost always a `redirect_uri` Auth0 does not recognise. |
| `login_required` from `getTokenSilently` | Third-party cookies blocked (Firefox Total Cookie Protection, Safari ITP). Expected without an Auth0 custom domain; sign in again to recover. |
| `Auth0 init failed: …` | `initAuth` caught and swallowed the error, leaving `auth0Client = null`. Everything then reports "not signed in" with no other clue, so read the warning itself. |
| Signed in with Google, but the API says you are the dev user | `dev_mode` is on in the running process: `AUTH0_DOMAIN` resolved to `dev` or `""`. Almost always a stale `export`. `curl /api/users/me` with no token — a 200 confirms it. |
| `401` on API calls with a token that looks fine | `AUTH0_AUDIENCE` does not match the token's `aud`. Decode the token and compare against Auth0 → APIs. |
| The API exits at startup with `CORS_ORIGINS=* is not allowed…` | `CORS_ORIGINS` is still the wildcard inherited from `.env.example`. |

## Stages 3 and 4

| Symptom | Cause |
|---|---|
| Status stuck at `validating` | No worker running. |
| Status `unchecked` | Validation could not run — the worker log has the traceback. In stage 3, usually `STUB_SUBMISSION_DIR` unset or wrong. |
| `unchecked`, worker says `stub_submission_dir is not a directory` | The path does not resolve — no `~`, no `$HOME`, no placeholder left in. |
| Every file fails with the same code | Ground truth missing or mismatched. Check `S3_GT_PREFIX` resolves to the generated `gt`. |
| `400 The uploaded file has no predictions for: […]` at submit | Stage 3 with a zip that is not `STUB_SUBMISSION_DIR`. The badges came from your file, the verdict from the stand-in. Zip the stand-in. |
| `NoCredentialsError` in the worker | `S3_STUB=false` with no MinIO running and no AWS credentials. |
| Completing an upload fails (stage 4) | The browser could not read the `ETag` header. MinIO exposes it by default; a real bucket needs `ExposeHeaders: ETag` in its CORS config. |

# Appendix C — further reading

| | |
|---|---|
| `docs/baselines_fixture.md` | The baselines fixture: what the metadata decides, and who owns the rows |
| `docs/validation_fixtures.md` | Deliberately broken submission zips, one per error code |
| `docs/ts1_dataset.md` | The ts1 dataset itself |
| `docs/frontend/build.md` | Vite, the Docker stage, cache headers — not needed for this loop |
| `docs/upload_lifecycle_todo.md` | Every way a submission's file can stall, fail or be abandoned |
| The private IBL dev site | Production deployment, AWS resources, Auth0 tenant setup |
