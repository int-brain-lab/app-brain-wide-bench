"""FastAPI application entrypoint: CORS, routers, health check."""

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.config import settings
from app.routers import leaderboard, meta, models, submissions, tasks, teams, users, tasksubmissions

app = FastAPI(title="brain-wide-bench", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class StaticCacheMiddleware(BaseHTTPMiddleware):
    """Set Cache-Control on static responses.

    ``/assets/`` holds the built frontend's content-hashed chunks, which a new build renames
    rather than overwrites. Everything else revalidates, HTML included: the document names the
    chunk filenames a reader loads.

    Serving ``frontend/`` unbuilt there is no ``/assets/``, and every path takes ``no-cache``.
    """

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        path = request.url.path
        if path.startswith("/api"):
            return response
        if path.startswith("/assets/"):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        else:
            response.headers["Cache-Control"] = "no-cache"
        return response


app.add_middleware(StaticCacheMiddleware)

app.include_router(submissions.router)
app.include_router(tasksubmissions.router)
app.include_router(tasksubmissions.listing)
app.include_router(leaderboard.router)
app.include_router(users.router)
app.include_router(models.router)
app.include_router(tasks.router)
app.include_router(teams.router)
app.include_router(meta.router)


@app.get("/health", tags=["health"])
async def health() -> dict:
    """Liveness probe."""
    return {"status": "ok"}


# Serve the frontend SPA last so API routes take precedence.
# html=True serves index.html at /.
_frontend = Path(__file__).parent.parent / "frontend"
if _frontend.is_dir():
    app.mount("/", StaticFiles(directory=_frontend, html=True), name="frontend")
