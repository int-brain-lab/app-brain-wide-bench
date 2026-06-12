"""S3 helpers: presigned upload URLs and ground-truth / submission downloads.

When :data:`app.config.settings.s3_gt_prefix` points at an existing local directory
the ground-truth helpers read from disk instead of S3, so the worker can run end to
end without an S3 bucket during development.
"""

from pathlib import Path

import boto3

from app.config import settings


def _client():
    """Return a boto3 S3 client for the configured region."""
    return boto3.client("s3", region_name=settings.aws_region)


def presign_put(key: str, content_type: str = "application/zip") -> str:
    """Generate a presigned ``PUT`` URL for a direct browser upload.

    Parameters
    ----------
    key : str
        Destination object key inside the submissions bucket.
    content_type : str
        ``Content-Type`` the client must send with the upload.

    Returns
    -------
    str
        A time-limited presigned URL.
    """
    return _client().generate_presigned_url(
        "put_object",
        Params={"Bucket": settings.s3_bucket, "Key": key, "ContentType": content_type},
        ExpiresIn=settings.s3_presign_expiry,
    )


def download_submission(s3_key: str, dest: Path) -> Path:
    """Download a submission zip from S3 to ``dest``."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    _client().download_file(settings.s3_bucket, s3_key, str(dest))
    return dest


def download_ground_truth(task: str, dest_dir: Path) -> Path:
    """Materialise the ground-truth tree for ``task`` under ``dest_dir``.

    If ``s3_gt_prefix`` is a local directory it is used as-is (returned directly).
    Otherwise every object under ``{s3_gt_prefix}`` is downloaded, preserving the
    key suffix as the local path so that
    ``{gt_dir}/{flat_task}/{recording_id}/causal/ground_truth.safetensors`` resolves.

    Parameters
    ----------
    task : str
        Benchmark task id (e.g. ``"ts1"``).
    dest_dir : Path
        Local directory to populate.

    Returns
    -------
    Path
        Root ground-truth directory to pass to the scorer.
    """
    local = Path(settings.s3_gt_prefix)
    if local.is_dir():
        return local

    prefix = settings.s3_gt_prefix.rstrip("/")
    client = _client()
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=settings.s3_bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            rel = key[len(prefix):].lstrip("/")
            target = dest_dir.joinpath(rel)
            target.parent.mkdir(parents=True, exist_ok=True)
            client.download_file(settings.s3_bucket, key, str(target))
    return dest_dir
