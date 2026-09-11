# Deploy

What has to change outside the code for the submission flow to work on a server. The code
itself goes out through `scripts/deploy.sh`, which pulls, rebuilds and migrates.

## The frontend's auth flag

`frontend/js/api/client.js` carries

```js
const DEV_MODE = true;
```

which signs the browser in against a `localStorage` flag instead of Auth0 and sends
`Bearer dev`. It has to be `false` to deploy: against a production API that verifies
signatures every request 401s instead, and against one that does not, anyone is let through
as its stub user.

Nothing enforces it yet — the one-line guard for `deploy.sh` is filed in `next_steps.md`,
alongside the other changes that script needs.

## S3 bucket

### CORS — required

The browser uploads each part straight to S3 and has to **read the `ETag`** off every
response; the completion call is assembled from them. Without `ExposeHeaders` the ETags are
invisible to JavaScript and no upload can ever be completed.

```json
[{
  "AllowedHeaders": ["*"],
  "AllowedMethods": ["PUT", "GET", "HEAD"],
  "AllowedOrigins": ["https://brainwidebench.iblcore.org"],
  "ExposeHeaders": ["ETag"],
  "MaxAgeSeconds": 3000
}]
```

One origin per site that serves the frontend.

### Lifecycle — not yet applied

The parts of an upload that is never completed or aborted are stored and billed, and do not
appear in a normal bucket listing. A submitter who closes the tab mid-upload leaves them
behind, and at 10 GB a submission that adds up.

**Not enabled yet, and it needs a code change first** — see item 12 of
`submission_validation_plan_todo.md`. The rule discards an upload S3 is still holding for a
row that says `uploading`, and three endpoints raise `NoSuchUpload` on that today.

What is already there is visible only through `ListMultipartUploads`:

```python
uploads = s3.list_multipart_uploads(Bucket=settings.s3_bucket).get("Uploads", [])

for upload in sorted(uploads, key=lambda u: u["Initiated"]):
    print(f"{upload['Initiated']:%Y-%m-%d %H:%M}  {upload['Key']}")
```

The rule itself:

```python
s3.put_bucket_lifecycle_configuration(
    Bucket=settings.s3_bucket,
    LifecycleConfiguration={
        "Rules": [
            {
                "ID": "abort-incomplete-multipart-uploads",
                "Status": "Enabled",
                "Filter": {},
                "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 7},
            }
        ]
    },
)
```

Three things about that call:

- **It replaces the whole configuration.** The Infrequent Access transition below, whenever it
  happens, goes in this same document rather than a second call. `get_bucket_lifecycle_configuration`
  first says what there is to lose; it raises `NoSuchLifecycleConfiguration` when there is none.
- **`Filter: {}` is bucket-wide on purpose.** A large `aws s3 cp` of ground truth is itself a
  multipart upload, so an interrupted one leaves the same orphans outside `submissions/`.
- **It needs admin credentials.** The instance role cannot read the CORS configuration, so it
  will not have `s3:PutLifecycleConfiguration` either. AWS evaluates the rule about once a
  day, so existing orphans go within 24 hours rather than at once.

The reaper (phase 2) will abort these as it prunes the rows, but the lifecycle rule is the
backstop that does not depend on our code running. Give the reaper the shorter window of the
two — three days against seven — so our code is normally what releases the parts and clears
the row together.

Worth considering alongside it: a transition of scored submissions to Infrequent Access, since
each one is tens of GB kept indefinitely.

### Ground-truth layout — no change

The bucket's `ground-truth/<suite>/<flat_task>/…` is what `download_ground_truth` expects. It
appends each suite the submission needs and strips that prefix as it downloads, landing a
flat-task-rooted tree locally — which is the layout the scorers look up.

## IAM

The old flow used a single presigned `PUT` and needed very little. Multipart needs more, and a
missing action surfaces as `AccessDenied` on the *browser's* `PUT` — a confusing place to
debug, because the failure is in a request our server never sees.

| Action | Used by |
| --- | --- |
| `s3:PutObject` | creating the upload, every part, completing it |
| `s3:AbortMultipartUpload` | discarding an upload; also the restart path |
| `s3:ListMultipartUploadParts` | the resume read (`GET /{id}/upload`) |
| `s3:GetObject` | the worker's download, and the post-upload size check |
| `s3:DeleteObject` | removing a file that failed validation |
| `s3:ListBucket` | the ground-truth paginator (on the bucket ARN, not the objects) |

## `.env`

### Required

```
S3_GT_PREFIX=ground-truth
```

Currently `ground-truth/ts1`. The prefix is now the root holding every suite, because one
submission may span suites and each needs its own ground truth. Left as a single suite's
prefix, the download looks under `ground-truth/ts1/ts1/`, finds nothing, and **every
`score_dir` skips missing ground truth silently** — so the symptom is a submission reaching
`done` with unscored tasks rather than an error.

### Optional, sensible defaults

| Setting | Default | Set it to |
| --- | --- | --- |
| `UPLOAD_PART_SIZE` | 64 MB | change only with reason; it is the retry granularity, and it must not change while uploads are in flight |
| `S3_PART_EXPIRY` | 43200 (12 h) | shorten only if a long upload is not expected |
| `MAX_SUBMISSION_BYTES` | 20 GB | the ceiling a submission is refused above, checked against the assembled object as well as the declared size |
| `MIN_DATASET_VERSION`, `MAX_DATASET_VERSION` | unset | a version range. **E108 does nothing until these are set** |

### Must stay absent

`S3_STUB`, `S3_ENDPOINT_URL` and `STUB_SUBMISSION_DIR` are the local-development modes
(`dev_setup.md`). Any of them set on a server changes where files are read from or written to.

`S3_PRESIGN_EXPIRY` is no longer read and is harmless if still present.

## Verify before deploying

Locally, against whatever `.env` names:

```bash
uv run --env-file .env python scripts/check_s3.py
```

On the server, inside the container — which is the environment that actually matters, and
needs no `--env-file` since `env_file: .env` has already injected it:

```bash
docker compose exec -T web uv run python scripts/check_s3.py
```

Exercises every S3 action the flow uses and reports the first one refused, so a missing IAM
permission is named here rather than surfacing inside a browser's `PUT` — a request the
server never sees. It also checks the browser would be able to read the `ETag` off a part
upload, and that `S3_GT_PREFIX` resolves to a root holding one directory per suite.

It writes one five-byte object under `submissions/_probe/` and deletes it again.

### Where the credentials come from

Nothing passes credentials explicitly, so boto3 walks its chain: environment variables (what
`env_file: .env` injects), then `~/.aws/credentials`, then an EC2 instance role via instance
metadata. Which link fired:

```bash
docker compose exec -T web uv run python -c "
import boto3
credentials = boto3.Session().get_credentials()
print('source:', getattr(credentials, 'method', None) if credentials else 'NONE')
print('identity:', boto3.client('sts').get_caller_identity()['Arn'])
"
```

`env` means the policy to widen belongs to the key in `.env`; `iam-role` means it belongs to
the instance role. `NONE` means S3 has never worked here — which would have gone unnoticed,
since the old flow only ever *signed* a URL (no network call) and the demo data was loaded
from a fixture, which bypasses S3 entirely.

An instance role has one gotcha: containers often cannot reach IMDSv2, because the default
put-response hop limit of 1 does not survive Docker's NAT. Raising it to 2 on the instance's
metadata options fixes it — though if the command above prints `iam-role`, it is already
reachable.

### An instance role shortens presigned URLs

Role credentials are temporary and rotate, roughly every six hours. **A presigned URL stops
working when the credentials that signed it expire, whatever `ExpiresIn` asked for** — so
`S3_PART_EXPIRY` of twelve hours is a request the credentials cannot honour, and the real
ceiling is however long the current ones have left.

Nothing breaks: a part answered `403` makes the browser re-sign everything still owed in one
request (`GET /{id}/upload`), and carry on. But it means that path runs in normal operation
rather than only on unusually long uploads — a 132-part upload can easily cross a rotation.
It is worth watching the first time a large submission goes up.

## Migration order

`scripts/deploy.sh` rebuilds the containers and *then* runs the migration:

```bash
docker compose up -d --build
docker compose exec -T web uv run alembic upgrade head
```

That is correct — `exec` lands in the container just built, which is where `0002` lives. The
cost is a window of a second or two where the new code serves traffic against the old schema,
and every `select(Submission)` fails with `UndefinedColumn`: the submission list, the
leaderboard, the model pages.

`0002` is additive — three nullable columns and four enum values — so the *old* code is happy
with the migrated schema. Which means the window can be closed by migrating before the swap,
and the migration cannot be run with `exec` first: the running container holds the previous
image, whose `alembic/versions/` has no `0002`. A one-off container of the new image is what
it takes:

```bash
docker compose build                                      # running site untouched
docker compose run --rm web uv run alembic upgrade head   # new image, same network
docker compose up -d                                      # swap the code in
docker compose restart nginx
```

Worth it for a busy site; the shorter form is fine for a test deploy.

## After deploying

- **The worker must be running.** Validation is a Celery task, and the submission form waits
  on it. `docker compose ps` should show `worker` up; it picks up `app.tasks.validate` from
  `app/worker.py`'s `include`.
- **Check the enum applied.** `compare_metadata` in `tests/test_migrations.py` does not compare
  enum members, so nothing else will tell you:

  ```bash
  docker compose exec -T db psql -U "$POSTGRES_USER" brainwidebench -c '\dT+ submissionstatus'
  ```

  Expect `uploading, validating, invalid, unchecked, pending, scoring, done, failed`.
- **The first real upload is the CORS test.** If parts upload but completing fails, the ETags
  are not being exposed.

## Worker disk

A submission is downloaded and extracted by validation, and again by scoring — so a 10 GB
submission wants roughly 20 GB of scratch space per concurrent job, on a volume that is
currently the same filesystem as the database.

Nothing here is sized for that. `worker_disk_plan_todo.md` has the measurements and the fixes
in order of value; the first two are a config change and a one-line unlink.
