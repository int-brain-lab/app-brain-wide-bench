"""FastAPI application entrypoint: CORS, routers, health check."""

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.routers import leaderboard, submissions, users

app = FastAPI(title="brain-wide-bench", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(submissions.router)
app.include_router(leaderboard.router)
app.include_router(users.router)


@app.get("/health", tags=["health"])
async def health() -> dict:
    """Liveness probe."""
    return {"status": "ok"}


# Serve the frontend SPA last so API routes take precedence.
# html=True serves index.html at /. no-cache so browsers always revalidate after deploys.
_frontend = Path(__file__).parent.parent / "frontend"
if _frontend.is_dir():

    class NoCacheStaticFiles(StaticFiles):
        async def get_response(self, path, scope):
            response = await super().get_response(path, scope)
            response.headers["Cache-Control"] = "no-cache"
            return response

    app.mount("/", NoCacheStaticFiles(directory=_frontend, html=True), name="frontend")
