#!/bin/bash
set -e
sudo -u ubuntu bash -c '
  set -e
  cd /srv/app-brain-wide-bench
  git pull
  docker compose up -d --build
  docker compose exec -T web uv run alembic upgrade head
  # Wait up to 2 minutes for uvicorn to be ready (rebuild can take ~60s on a cold cache).
  for i in $(seq 1 24); do
    docker compose exec -T web curl -sf http://localhost:8080/health | grep -q "\"status\":\"ok\"" \
      && echo "Deploy complete." && exit 0
    echo "Waiting for health check... ($i/24)"
    sleep 5
  done
  echo "Health check failed after 120s." && exit 1
'
