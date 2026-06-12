# Backend image for the FastAPI web service and the Celery worker.
# Build context is the repo root so the editable ../ibl-benchmark dependency resolves.
FROM python:3.13-slim

# uv for fast, reproducible installs.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

# Copy the editable local dependency first, then the backend project.
COPY ibl-benchmark/ ./ibl-benchmark/
COPY app-brain-wide-bench/pyproject.toml app-brain-wide-bench/uv.lock* ./app-brain-wide-bench/

WORKDIR /app/app-brain-wide-bench
RUN uv sync --no-dev

# Copy the backend source.
COPY app-brain-wide-bench/ ./

ENV PATH="/app/app-brain-wide-bench/.venv/bin:$PATH"
EXPOSE 8080
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
