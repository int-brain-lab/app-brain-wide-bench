"""Application settings loaded from environment variables."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration sourced from the environment / ``.env`` file.

    Attributes
    ----------
    database_url : str
        SQLAlchemy connection string using psycopg3 (``postgresql+psycopg://``).
        The same URL serves the async FastAPI engine and the sync Alembic engine.
    redis_url : str
        Redis URL used as the Celery broker and result backend.
    auth0_domain : str
        Auth0 tenant domain. When set to ``"dev"`` the API runs with a stub
        authentication backend (no JWT required) for local development.
    auth0_audience : str
        Expected ``aud`` claim of incoming access tokens.
    aws_region, s3_bucket : str
        Target S3 bucket for submission uploads.
    s3_gt_prefix : str
        Key prefix (or local path) where ground-truth oracle files live.
    cors_origins : str
        Comma-separated list of allowed CORS origins.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # PostgreSQL
    database_url: str = "postgresql+psycopg://bwb:bwb@localhost:5432/brainwidebench"

    # Redis / Celery
    redis_url: str = "redis://localhost:6379/0"

    # Auth0 ("dev" disables JWT verification for local development)
    auth0_domain: str = "dev"
    auth0_audience: str = "https://api.brainwidebench.org"

    # AWS / S3
    aws_region: str = "us-east-1"
    s3_bucket: str = "brainwidebench-submissions"
    s3_presign_expiry: int = 3600

    # Ground-truth oracle: S3 prefix, or a local directory for dev/testing
    s3_gt_prefix: str = "ground-truth/ts1"

    # CORS
    cors_origins: str = "*"

    @property
    def dev_mode(self) -> bool:
        """Whether authentication runs in local stub mode."""
        return self.auth0_domain in ("", "dev")

    @property
    def cors_origin_list(self) -> list[str]:
        """CORS origins split into a list."""
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    """Return a cached :class:`Settings` instance."""
    return Settings()


settings = get_settings()
