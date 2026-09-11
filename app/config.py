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
    s3_endpoint_url : str
        Non-AWS S3 endpoint (MinIO in development). Empty means real AWS.
    s3_stub : bool
        Return placeholders from the upload helpers instead of calling S3, for local work
        with no bucket. Must be off to reach ``s3_endpoint_url``.
    stub_submission_dir : str
        Local prediction directory validation reads when stubbed, since a skipped upload
        leaves nothing to read. Every status transition and the real validator still run;
        the file the submitter chose is not what is checked.
    s3_part_expiry : int
        Lifetime in seconds of a presigned part URL. Long, because a multi-hour upload
        outlives a normal presign window.
    upload_part_size : int
        Multipart chunk size in bytes. S3 requires at least 5 MB per part except the last,
        and at most 10,000 parts.
    max_submission_bytes : int
        Largest submission zip accepted. Checked at create against the size the client
        declares, and again against the assembled object, which is the only size that is
        actually true.
    s3_gt_prefix : str
        Key prefix (or local path) holding the ground truth, one directory per suite
        beneath it. A local path is expected flat-task-rooted instead — see
        ``download_ground_truth``.
    min_dataset_version, max_dataset_version : str
        Inclusive ``x.y.z`` bounds on a submission's ``dataset_version`` metadata. Empty
        leaves that side unbounded.
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
    s3_endpoint_url: str = ""
    s3_stub: bool = False
    stub_submission_dir: str = ""
    s3_part_expiry: int = 43200
    upload_part_size: int = 64 * 1024 * 1024
    max_submission_bytes: int = 20 * 1024**3

    # Ground-truth oracle: S3 prefix holding every suite, or a local directory for dev
    s3_gt_prefix: str = "ground-truth"

    # Accepted dataset_version range for a submission (empty = unbounded)
    min_dataset_version: str = ""
    max_dataset_version: str = ""

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
