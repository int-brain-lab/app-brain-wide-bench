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

**Where that disk is.** Fixed by issue #42: the `worker` service now bind-mounts
`BWB_SCRATCH_DIR`/`BWB_GT_DIR` to `/scratch`/`/ground-truth`, and `TMPDIR=/scratch` moves
`tempfile.TemporaryDirectory()` off the container's writable overlay layer. In production
those host paths are a dedicated EBS volume, not the root volume — a job that fills it no
longer takes anything else on the host down with it. (The database moved off-box
separately, to RDS.)

**The multiplier.** `command: uv run celery -A app.worker worker --loglevel=info` passes no
`--concurrency`, so the prefork pool defaults to the CPU count. Four vCPUs means four
concurrent jobs: ~80 GB plus ground truth, on the volume the database is on.

Two related sharp edges (a third — every concurrent job keeping its own copy of the ground
truth — is fixed by issue #42's persistent GT volume):

- **`BaseScorer.extract` is unbounded.** It checks `is_zipfile` and then `extractall`s.
  Honest submissions are ~1:1, but a zip of zero-filled tensors compresses enormously — a
  500 MB upload could become hundreds of GB on disk. A bug in someone's writer is enough;
  no malice required.
- **An OOM kill leaks the temp directory.** `TemporaryDirectory` cleans up on exceptions,
  the `raise exc` path included, but not on SIGKILL. Those orphans persist in the container
  layer until the next deploy recreates it.

**What's left to do, in order of value:**

1. **`zip_path.unlink()` as soon as `extract` returns.** The archive is dead by then in both
   tasks. Cuts the footprint from ~20 GB to ~10 GB for the whole scoring phase, which is
   where the time is spent. It does not lower the peak *during* extraction, where both
   necessarily coexist.
2. **`--concurrency=1` for the heavy work**, ideally on its own queue so validation and
   scoring do not compete, with a separate light worker for everything else. There is one
   queue and one worker today.
3. **Two cheap guards in both tasks:** sum `ZipInfo.file_size` from the central directory and
   refuse an implausible expansion ratio before extracting; and check `shutil.disk_usage`
   before starting, so a job that cannot fit fails fast with a clear status instead of dying
   mid-extract. The pre-flight endpoint gets the first for free — the client already reads
   the central directory, so a declared uncompressed size can be refused before the upload
   even starts.
4. **Optional, if peak is still binding:** do not store the zip at all. `zipfile.ZipFile`
   accepts any seekable binary file object, so a small S3-backed reader doing ranged GETs
   extracts straight from the bucket. The only measure that removes the archive from peak
   entirely. It trades boto3's parallel download for sequential ranged reads — measure
   before adopting.

**Unknowns blocking the sizing:** the ground-truth tree size per suite; the instance's vCPU
count; and how many submissions are expected in flight at once. With those the volume is
`G + C x 20 GB` plus headroom, or `G + C x 10 GB` with fix 1, and `G + C x 10 GB` with no
extraction spike at all with fix 4.

