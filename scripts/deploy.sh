#!/bin/bash
set -e
sudo -u ubuntu bash -c '
  set -e
  cd /srv/app-brain-wide-bench
  git pull
  docker compose up -d --build
  docker compose exec -T web uv run alembic upgrade head
'
# Wait for web container to be ready (up to 30s)
for i in $(seq 1 10); do
  curl -sfL https://brainwidebench.iblcore.org/health | grep -q '"status":"ok"' && echo "Deploy complete." && exit 0
  echo "Waiting for health check... ($i/10)"
  sleep 3
done
echo "Health check failed after 30s." && exit 1
