"""Submit the sample zip through the API and score it locally.

No S3 bucket or Celery worker needed — the Celery task is run synchronously
in this process, and its S3 download calls are redirected to local files.

Prerequisites
-------------
- Docker Compose db+redis running (docker compose up -d db redis)
- DB migrated (DATABASE_URL=... uv run alembic upgrade head)
- API running on port 8000 (DATABASE_URL=... uv run python -m uvicorn app.main:app --port 8000)
- Local ground truth at ~/Documents/datadisk/brain-wide-bench/ts1/

Usage
-----
    DATABASE_URL=postgresql+psycopg://brainwidebench:changeme@localhost:5434/brainwidebench \\
      uv run python examples/submit_local.py
"""

import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

# Load .env then .env.local before any app import.
# async_session_factory is built at module import time from settings.database_url,
# so env vars must be in place before the first `import app.*`.
# .env.local overrides the Docker hostnames (db, redis) with localhost equivalents.
_root = Path(__file__).parent.parent
load_dotenv(_root / ".env")
load_dotenv(_root / ".env.local", override=True)

import httpx  # noqa: E402

API = "http://localhost:8000"
ZIP_PATH = Path(__file__).parent.parent / "tests" / "fixtures" / "sample.zip"
GT_DIR = Path.home().joinpath("Documents", "datadisk", "brain-wide-bench", "ts1")


def _check() -> None:
    if not ZIP_PATH.exists():
        sys.exit(f"Fixture zip not found: {ZIP_PATH}")
    if not GT_DIR.exists():
        sys.exit(f"Ground-truth dir not found: {GT_DIR}")
    try:
        httpx.get(f"{API}/health", timeout=3).raise_for_status()
    except Exception as exc:
        sys.exit(f"API not reachable at {API} — is uvicorn running?\n{exc}")


def main() -> None:
    _check()

    # ── 1. Presign: create a pending submission record and get the S3 URL ────
    resp = httpx.post(
        f"{API}/api/submissions/presign",
        json={
            "title": "MLP baseline (local demo)",
            "description": "Demo run using tests/fixtures/sample.zip",
            "affiliation": "IBL",
            "email": "demo@brainwidebench.org",
            "task": "ts1",
            "is_public": True,
        },
    )
    resp.raise_for_status()
    presign = resp.json()
    submission_id = presign["submission_id"]
    print(f"[1/4] Submission created  id={submission_id}")
    print(f"      upload_url: {presign['upload_url'][:72]}…")
    print("      (Skipping S3 PUT — fixture zip used directly for scoring)")

    # ── 2. Submit: mark the upload complete and enqueue the scoring task ──────
    resp = httpx.post(f"{API}/api/submissions/{submission_id}/submit")
    resp.raise_for_status()
    print(f"[2/4] /submit called      status={resp.json()['status']}")

    # ── 3. Score synchronously (no broker, no S3) ─────────────────────────────
    # Redirect the two S3 helpers imported into the tasks module to local files.
    import app.tasks.score as _task  # noqa: PLC0415

    _task.download_submission = lambda s3_key, dest: ZIP_PATH
    _task.download_ground_truth = lambda task, dest_dir: GT_DIR

    print("[3/4] Scoring…")
    outcome = _task.score_submission.apply(args=[submission_id]).get()
    print(f"      Task outcome: {outcome}")

    # ── 4. Fetch the scored submission and check the leaderboard ──────────────
    resp = httpx.get(f"{API}/api/submissions/{submission_id}")
    resp.raise_for_status()
    detail = resp.json()
    print(f"[4/4] Submission detail   status={detail['status']}")
    print(json.dumps(detail.get("score_results"), indent=2))

    resp = httpx.get(f"{API}/api/leaderboard")
    resp.raise_for_status()
    board = resp.json()
    print(f"\nLeaderboard ({len(board)} row(s)):")
    for row in board:
        tasks_summary = ", ".join(f"{k}={v['mean']:.3f}" for k, v in row.get("summary", {}).items())
        print(f"  {row['title']:<35}  {row['status'] if 'status' in row else 'done'}  {tasks_summary}")


if __name__ == "__main__":
    main()