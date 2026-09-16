# Frontend bundle. Node runs here only; the runtime image holds the built output.
FROM node:22-alpine AS frontend

WORKDIR /build

# Manifests before the source, keeping the install layer across a frontend edit.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build


# Backend image for the FastAPI web service and the Celery worker.
FROM python:3.13-slim

# uv for fast, reproducible installs.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

COPY pyproject.toml uv.lock* ./
RUN uv sync --no-dev

# Copy the backend source.
COPY . .

# The source tree is removed first: COPY merges into an existing directory, and an unbundled
# js/ left beside the hashed chunks is still reachable at its old URL.
RUN rm -rf frontend
COPY --from=frontend /build/dist ./frontend

# uid/gid 1000 matches `ubuntu` on the production host's Ubuntu AMI, which owns the
# worker's bind-mounted /scratch and /ground-truth (docs/worker_disk_plan_todo.md) — both
# get written to, not just read, so the container's user has to match the host owner
# rather than merely have read access. Verify with `id ubuntu` on the instance if it was
# ever provisioned differently.
RUN groupadd --gid 1000 app && useradd --uid 1000 --gid 1000 --create-home appuser

# /app is root-owned from the COPY/uv sync steps above. `uv run` re-syncs the editable
# install on every start (touches app_brain_wide_bench.egg-info under /app), so appuser
# needs write access there, not just read.
RUN chown -R appuser:app /app
USER appuser

ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8080
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
