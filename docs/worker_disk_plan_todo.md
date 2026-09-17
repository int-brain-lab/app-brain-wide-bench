# Worker disk TODO

**Done:** the worker's scratch space and ground-truth cache are on their own EBS volume
(`BWB_SCRATCH_DIR`/`BWB_GT_DIR` → `/scratch`/`/ground-truth`, `TMPDIR=/scratch`), no longer
sharing a filesystem with anything else on the host — closed by issue #42 / PR #43.

**Outstanding work** (unbounded `extractall`, no archive cleanup, unbounded worker
concurrency, and the streaming-extraction option) is tracked in
[issue #47](https://github.com/int-brain-lab/app-brain-wide-bench/issues/47), which also
covers the zip-bomb risk from the pre-launch security audit — the same code path, so one
issue rather than two. This file is kept only as the design record behind that issue's
analysis (the per-job footprint math, the multiplier from unset `--concurrency`), not as a
second place to track the work itself.

---

Audit scope: `docker-compose.yml`, `app/tasks/score.py`, `app/storage.py`, `app/scoring/base.py`

**Per job.** `score_submission` downloads the zip, downloads ground truth, then extracts.
safetensors are float arrays and essentially incompressible, so a 10 GB zip becomes ~10 GB
extracted, and both exist at once because extraction cannot free the archive it is reading.
One job therefore peaks at **~20 GB + G**, where G is the ground-truth tree. Validation adds
a second, separate episode of the same shape for the same submission.

**The multiplier.** `command: uv run celery -A app.worker worker --loglevel=info` passes no
`--concurrency`, so the prefork pool defaults to the CPU count. Four vCPUs means four
concurrent jobs: ~80 GB plus ground truth, on the scratch volume — no longer shared with the
database now that it's on RDS, but still one volume across every concurrent job.

Two related sharp edges (a third — every concurrent job keeping its own copy of the ground
truth — is fixed by issue #42's persistent GT volume):

- **`BaseScorer.extract` is unbounded.** It checks `is_zipfile` and then `extractall`s.
  Honest submissions are ~1:1, but a zip of zero-filled tensors compresses enormously — a
  500 MB upload could become hundreds of GB on disk. A bug in someone's writer is enough;
  no malice required.
- **An OOM kill leaks the temp directory.** `TemporaryDirectory` cleans up on exceptions,
  the `raise exc` path included, but not on SIGKILL. Those orphans persist in the container
  layer until the next deploy recreates it.

**Unknowns blocking the sizing:** the ground-truth tree size per suite; the instance's vCPU
count; and how many submissions are expected in flight at once. With those the volume is
`G + C x 20 GB` plus headroom, or `G + C x 10 GB` with the archive-cleanup fix, and
`G + C x 10 GB` with no extraction spike at all with the streaming-extraction fix — see
issue #47 for the fixes themselves.
