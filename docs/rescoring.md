# Re-scoring

Scoring a submission's file again, against the tasks it already entered. No task rows are
created and no file is re-uploaded.

Two routes, by how many submissions:

|      | Route                                              |
| ---- | -------------------------------------------------- |
| One  | The Re-score button                                |
| Many | `rescore_from_s3.py`, then `update_task_scores.py` |

Both read the submission's file from the bucket. A submission whose `s3_key` names a local
prediction directory instead — the baselines, as the fixture loaded them — has nothing for
the worker to download, and takes the third route below.

## Before any of them

Re-scoring is admin-only. The account must have signed in at least once, so the row exists:

```bash
docker compose exec -T web uv run python scripts/set_user_role.py --list
docker compose exec -T web uv run python scripts/set_user_role.py you@example.org admin
```

An unknown email is an error rather than a new row.

Back up the database before anything that writes:

```bash
docker compose exec -T db pg_dump -U <user> <db> | gzip > bwb-before-rescore.sql.gz
```

## One submission — the Re-score button

On the submission's details page, beside Edit and Delete. Shown only to an admin, and only
when the submission is `done`, `failed` or `scoring`.

1. Open the submission, press **Re-score**.
2. The confirmation names the tasks whose scores the run replaces. Confirm.
3. The submission moves to `scoring`, and to `done` or `failed` when the worker finishes.

The scores it has stand until the new ones are written. A run that fails leaves them in
place and the status at `failed`.

Refusals, in the confirmation card:

| Message                                                           | Means                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------ |
| `A submission is re-scored from done or failed or scoring, not …` | Its tasks have not been chosen yet                     |
| `This submission's file is no longer stored`                      | The object is gone, or the key names a local directory |

`scoring` is offered for a run whose worker died. A worker that is still alive is raced
rather than stopped, so only use it when you know the run is dead.

## Baselines still naming a local directory

Optional: `attach_baseline_files.py` moves them onto the two routes above for good, and is
worth doing once rather than repeating this each time.

### Moving them onto the bucket

Zip each prediction directory with the label folder as the root entry, and upload it to
`submissions/<submission id>/<label>.zip`.

```bash
cd <prediction root>
zip -r -0 /tmp/<label>.zip <label>
```

`-0` because safetensors do not compress. Then, on the server:

```bash
docker compose exec -T web uv run python scripts/attach_baseline_files.py
docker compose exec -T web uv run python scripts/attach_baseline_files.py --apply
```

The report lists every baseline, the key it looked for, and whether the object is there.
`file_size` is read from the object, so the files need not be on the server. Only rows whose
object exists are written, so run it again as uploads land.

Upload the zip without renaming it: the key is right because the filename is. An archive
placed under the wrong id is attached and scored without complaint, since scoring reads each
prediction file's label from its metadata rather than its path.

### Scoring them where the files are

Without that, they are scored from the local prediction files, which means running where
those files are rather than on the server.

```bash
uv run python scripts/make_baselines.py --public \
  --owner-id <the owner uuid on the target database> \
  --snapshot tests/fixtures/rescored_baselines.json
```

Then copy the fixture in and apply it. The rows already exist, so this updates them;
`load_fixture_data.py` would collide.

```bash
scp tests/fixtures/rescored_baselines.json <host>:~/
docker compose cp ~/rescored_baselines.json web:/app/tests/fixtures/rescored_baselines.json

docker compose exec -T web uv run python scripts/update_task_scores.py \
  tests/fixtures/rescored_baselines.json
```

Check the report, then repeat with `--apply`.

Drop any submission that has since been deleted or resubmitted from the fixture's
`submissions`, `submission_users`, `task_submissions` and `task_scores` before applying:
`update_task_scores.py` refuses outright if any id is missing from the database.

## Many at once

Runs in the `worker` service, which has the scratch volume and the S3 credentials. One
submission at a time, smallest first.

```bash
docker compose exec -T worker df -h /scratch
docker compose exec -T worker uv run python scripts/rescore_from_s3.py --dry-run
```

The dry run downloads nothing. It prints the workload, the baselines it will not touch, and
any submission whose object is gone.

Rehearse on one, and apply it before committing to the rest:

```bash
docker compose exec -T worker uv run python scripts/rescore_from_s3.py \
  --only <label> --snapshot /scratch/rescored.json

docker compose exec -T worker uv run python scripts/update_task_scores.py /scratch/rescored.json
```

Then the batch, under `tmux` — `docker compose exec` dies with your shell:

```bash
tmux new -s rescore
docker compose exec worker uv run python scripts/rescore_from_s3.py \
  --resume --snapshot /scratch/rescored.json
```

`/scratch` rather than a path inside the container: the fixture lands on the host at
`${BWB_SCRATCH_DIR}` and survives the container. The fixture is rewritten after every
submission, so an interrupt loses at most the one in flight — rerun with `--resume`.

Then report and apply:

```bash
docker compose exec -T worker uv run python scripts/update_task_scores.py /scratch/rescored.json
docker compose exec -T worker uv run python scripts/update_task_scores.py /scratch/rescored.json --apply
```

## Reading the report

```
85 task_scores row(s) in the fixture, all present in bwb
  with overall  85
  unchanged     0
  to update     85
```

Two refusals, both of which write nothing:

- **ids not in the database** — the fixture names a row that has been deleted. Remove it
  from the fixture and re-run.
- **a mean moved by more than `--max-mean-delta`** — the same predictions scored by the same
  code differ only in summation order. A real move means the scoring changed. Find out why
  before raising the threshold.

Run the batch off-peak. The scratch volume is shared with live validation and scoring.
