# Dev setup

Running the app locally, including the submission flow. Two storage modes:

| | Simple | Realistic |
|---|---|---|
| Object store | none | MinIO |
| The upload | skipped | real multipart, real ETags |
| What gets validated | a directory you point at | the file you picked |
| Extra containers | — | minio |

Start with Simple. Switch to Realistic to exercise the upload itself.

Auth is separate and orthogonal — see `local_dev.md`. Everything here assumes
`AUTH0_DOMAIN=dev`, which is what `DEV_MODE = true` in `frontend/js/api/client.js` expects.
The two have to agree in either direction: a stub browser against a real tenant 401s on every
request, and a real sign-in against a stub API gets a token the API ignores.

## 1. Containers

```bash
podman volume create bwb-pgdata

podman run -d --name bwb-postgres -p 5434:5432 \
  -e POSTGRES_DB=brainwidebench \
  -e POSTGRES_USER=brainwidebench \
  -e POSTGRES_PASSWORD=changeme \
  -v bwb-pgdata:/var/lib/postgresql/data \
  postgres:16

podman run -d --name bwb-redis -p 6379:6379 redis:7-alpine
```

Redis is not optional: validation runs in a Celery worker, and the form waits on it.

`docker-compose.yml` describes the same services for the deploy. `podman compose` needs an
external compose provider, so the standalone commands above are the local path.

## 2. `.env.local`

```
DATABASE_URL=postgresql+psycopg://brainwidebench:changeme@localhost:5434/brainwidebench
REDIS_URL=redis://localhost:6379/0
AUTH0_DOMAIN=dev
AUTH0_AUDIENCE=https://api.brainwidebench.org
```

Storage settings go here too — see step 4.

## 3. Schema and data

```bash
uv run --env-file .env.local alembic upgrade head
uv run --env-file .env.local python scripts/load_fixture_data.py tests/fixtures/2026_09_baselines.json
uv run --env-file .env.local python scripts/set_user_role.py benchmark@internationalbrainlab.org admin
```

The baselines fixtures own their rows as `app.auth.DEV_SUB` by default, the same identity dev
mode resolves every request to, so what they load is already the stub user's own. A deployment
pins a real account's sub instead — see `baselines_fixture.md`.

The load wants an empty database and stops if it finds one that is not — add `--append` to
load a second fixture into it instead.

`set_user_role.py` makes that user an `admin` — every team's models, submissions and teams
become readable and writable. Its email is the fixture's `benchmark@internationalbrainlab.org`
until the first dev-mode request rewrites it to `dev@brainwidebench.org`, which is the address
to pass once the app has been opened.

Team membership comes from the fixture, and is what the submission form needs: `/me/models`
answers from real team membership, not from the role, and the form refuses to load with
nothing to choose.

## 4. A submission to validate

The validator only accepts predictions *and* the ground truth their `trial_id`s are checked
against. Without the multi-GB dataset, generate a matching pair:

```bash
uv run python -c "
from pathlib import Path
from tests.fixtures.submissions import write_submission
print(write_submission(Path.home() / 'bwb-dev-fixture'))
"
```

It prints the two paths it wrote. **Paste those verbatim into the settings below** —
`pydantic-settings` expands neither `~` nor `$HOME`, and a path that does not resolve goes
unnoticed until the worker runs.

One task, one recording, three seeds, and its ground truth. Delete a metadata key from one of
the files to see a failure instead.

### Simple

Add to `.env.local`:

```
S3_STUB=true
STUB_SUBMISSION_DIR=/home/user/bwb-dev-fixture/pred
S3_GT_PREFIX=/home/user/bwb-dev-fixture/gt
```

Then zip the fixture, and pick *that* in the form:

```bash
cd ~/bwb-dev-fixture/pred && zip -r ~/bwb-dev-fixture/submission.zip .
```

**It has to be a zip of `STUB_SUBMISSION_DIR`, not any zip.** The two halves of the flow read
different things here: prevalidation reads the archive's own directory listing in the browser,
so the detected tasks are your real file's, while the worker reads `STUB_SUBMISSION_DIR`
because a skipped upload left nothing to read back. `submit` then checks the tasks you
configured against the tasks validation found — and refuses with a 400 if they differ. Zipping
the stand-in is what makes them agree.

### Realistic

```bash
podman volume create bwb-minio

podman run -d --name bwb-minio -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  -v bwb-minio:/data \
  minio/minio server /data --console-address ":9001"

podman run --rm --network=host --entrypoint sh minio/mc -c \
  "mc alias set local http://localhost:9000 minioadmin minioadmin &&
   mc mb --ignore-existing local/brainwidebench-submissions"
```

Add to `.env.local`:

```
S3_STUB=false
S3_ENDPOINT_URL=http://localhost:9000
S3_BUCKET=brainwidebench-submissions
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
S3_GT_PREFIX=/home/user/bwb-dev-fixture/gt
```

Make a zip the validator will accept:

```bash
cd ~/bwb-dev-fixture/pred && zip -r ~/bwb-dev-fixture/submission.zip .
```

Console: <http://localhost:9001>, same credentials. It is the quickest way to see whether
parts arrived.

## 5. Run

Two terminals:

```bash
uv run --env-file .env.local uvicorn app.main:app --reload --port 8000
uv run --env-file .env.local celery -A app.worker worker --loglevel=info
```

<http://localhost:8000> — `app/main.py` mounts `frontend/` at `/`, so there is no separate
static server.

## 6. Check it worked

Create a submission at `/html/submissions/submission_create.html`. Expected:

1. picking the file locks `Deterministic` above it and fills the detected-task badges within
   a second — that is prevalidation, and nothing has been sent yet
2. the tasks panel unlocks, and "Upload file for validation" appears
3. pressing it locks Delete, and the file panel says "Checking the file…"
4. the file panel turns green, the visibility panel opens, and the submit button enables
5. submitting redirects to the submission, status `scoring`

The worker log shows one line per validation, and every finding's internal detail.

## Notes

- **A one-part upload proves little.** The fixture zip is about a kilobyte, so multipart's
  retry and resume paths never fire. Padding a copy to 200 MB gives four parts and a corrupt
  archive: the transfer is exercised, then validation fails. Two separate things to test.
- **Ground truth stays local in both modes.** `download_ground_truth` returns `s3_gt_prefix`
  as-is when it names a directory, so there is nothing to upload to MinIO.
- **In production `S3_GT_PREFIX` is a bucket prefix** holding one directory per suite
  (`ground-truth/ts1/…`), not a single suite's prefix.

## Testing the failure paths

`validation_fixtures.md` — a generator for submission zips that fail on purpose, one per
error code, and where each failure surfaces.

## When it breaks

| Symptom | Cause |
|---|---|
| `401` on every request | API is not in dev mode. `AUTH0_DOMAIN=dev`. |
| Form says "You have no models yet" | The loaded fixture puts the stub user on no team. `2026_09_baselines.json` does. |
| Status stuck at `validating` | No worker running. |
| Status `unchecked` | Validation could not run — worker log has the traceback. In Simple mode, usually `STUB_SUBMISSION_DIR` unset or wrong. |
| Every file fails with the same code | Ground truth missing or mismatched. Check `S3_GT_PREFIX` resolves to the generated `gt`. |
| `400 The uploaded file has no predictions for: […]` at submit | Simple mode with a zip that is not `STUB_SUBMISSION_DIR`. The pills came from your file, the verdict from the stand-in. Zip the stand-in. |
| `NoCredentialsError` in the worker | `S3_STUB=false` with no MinIO or AWS credentials. |
| `unchecked`, worker says `stub_submission_dir is not a directory` | The path does not resolve — no `~`, no `$HOME`, no placeholder left in. |
| Storage settings changed but nothing behaves differently | `--env-file` is read at process start. Restart both uvicorn and the worker. |
| Completing an upload fails (Realistic) | The browser could not read the `ETag` header. MinIO exposes it by default; a real bucket needs `ExposeHeaders: ETag` in its CORS config. |
