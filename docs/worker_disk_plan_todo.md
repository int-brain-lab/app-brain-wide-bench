# Worker disk TODO

Audit scope: `docker-compose.yml`, `app/tasks/score.py`, `app/storage.py`, `app/scoring/base.py`

Nothing here is specific to validation: `app/tasks/score.py` already has this shape, on a
volume nobody has sized for it. Validation doubles the number of times it happens per
submission, which is what surfaced it.

No numbers have been measured yet — see the unknowns at the end.

**Per job.** `score_submission` downloads the zip, downloads ground truth, then extracts.
safetensors are float arrays and essentially incompressible, so a 10 GB zip becomes ~10 GB
extracted, and both exist at once because extraction cannot free the archive it is reading.
One job therefore peaks at **~20 GB + G**, where G is the ground-truth tree. Validation adds
a second, separate episode of the same shape for the same submission.

**Where that disk is.** The `worker` service has no `volumes:` key, and
`tempfile.TemporaryDirectory()` defaults to `/tmp` *inside the container* — so every byte
lands in the container's writable overlay layer under `/var/lib/docker/overlay2`, on the
host's root volume. `postgres_data` is a named Docker volume, which by default lives under
`/var/lib/docker` too. Unless that has been given its own device, the worker's scratch space
and the database share one filesystem, and a job that fills it does not merely fail — it
takes Postgres with it.

**The multiplier.** `command: uv run celery -A app.worker worker --loglevel=info` passes no
`--concurrency`, so the prefork pool defaults to the CPU count. Four vCPUs means four
concurrent jobs: ~80 GB plus ground truth, on the volume the database is on.

Three related sharp edges:

- **Every concurrent job keeps its own copy of the ground truth.** `download_ground_truth`
  now fetches only the suites a submission actually contains, so a single-suite submission no
  longer pays for the whole tree — but nothing is shared between jobs, and each one
  re-downloads into its own temp dir. Fix 1 below removes both costs.
- **`BaseScorer.extract` is unbounded.** It checks `is_zipfile` and then `extractall`s.
  Honest submissions are ~1:1, but a zip of zero-filled tensors compresses enormously — a
  500 MB upload could become hundreds of GB on disk. A bug in someone's writer is enough;
  no malice required.
- **An OOM kill leaks the temp directory.** `TemporaryDirectory` cleans up on exceptions,
  the `raise exc` path included, but not on SIGKILL. Those orphans persist in the container
  layer until the next deploy recreates it.

**What to do, in order of value:**

1. **Put ground truth on a persistent read-only volume and point `s3_gt_prefix` at it.** No
   code change — `download_ground_truth` already returns a local directory as-is when the
   path exists. GT is identical for every submission and changes rarely, so this removes it
   from the per-job footprint *and* deletes a full re-download per job. Biggest win,
   smallest diff.
2. **`zip_path.unlink()` as soon as `extract` returns.** The archive is dead by then in both
   tasks. Cuts the footprint from ~20 GB to ~10 GB for the whole scoring phase, which is
   where the time is spent. It does not lower the peak *during* extraction, where both
   necessarily coexist.
3. **A dedicated scratch volume mounted into the worker, with `TMPDIR` set to it.** Isolates
   the database from a runaway job; gp3 resizes online, so it can grow without a rebuild.
4. **`--concurrency=1` for the heavy work**, ideally on its own queue so validation and
   scoring do not compete, with a separate light worker for everything else. There is one
   queue and one worker today.
5. **Two cheap guards in both tasks:** sum `ZipInfo.file_size` from the central directory and
   refuse an implausible expansion ratio before extracting; and check `shutil.disk_usage`
   before starting, so a job that cannot fit fails fast with a clear status instead of dying
   mid-extract. The pre-flight endpoint gets the first for free — the client already reads
   the central directory, so a declared uncompressed size can be refused before the upload
   even starts.
6. **Optional, if peak is still binding:** do not store the zip at all. `zipfile.ZipFile`
   accepts any seekable binary file object, so a small S3-backed reader doing ranged GETs
   extracts straight from the bucket. The only measure that removes the archive from peak
   entirely. It trades boto3's parallel download for sequential ranged reads — measure
   before adopting.

**Unknowns blocking the sizing:** the ground-truth tree size per suite; the instance's vCPU
count and root volume size, and whether `postgres_data` is on its own device; and how many
submissions are expected in flight at once. With those the volume is
`G + C x 20 GB` plus headroom, or `G + C x 10 GB` with fix 2, and `G + C x 10 GB` with no
extraction spike at all with fix 6.

