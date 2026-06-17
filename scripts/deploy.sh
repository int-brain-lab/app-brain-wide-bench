#!/bin/bash
set -e
sudo -u ubuntu bash << 'DEPLOY'
  set -e
  cd /srv/app-brain-wide-bench
  git pull
  docker compose up -d --build
  docker compose exec -T web uv run alembic upgrade head
  # Wait up to 2 minutes for uvicorn to be ready (rebuild can take ~60s on a cold cache).
  # Use `if` to keep set -e from aborting on failed attempts.
  for i in $(seq 1 24); do
    if docker compose exec -T web python3 -c "
import urllib.request, sys
try:
    urllib.request.urlopen('http://localhost:8080/health')
    sys.exit(0)
except Exception:
    sys.exit(1)
" 2>/dev/null; then
      echo "Deploy complete." && exit 0
    fi
    echo "Waiting for health check... ($i/24)"
    sleep 5
  done
  echo "Health check failed after 120s." && exit 1
DEPLOY
