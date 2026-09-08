"""S3 helpers: multipart uploads, presigned URLs, and ground-truth / submission downloads.

:data:`app.config.settings.s3_endpoint_url` selects a non-AWS endpoint such as MinIO, and
:data:`app.config.settings.s3_stub` stands in for having no object store at all.

When :data:`app.config.settings.s3_gt_prefix` points at an existing local directory
the ground-truth helpers read from disk instead of S3, so the worker can run end to
end without an S3 bucket during development.
"""

import re
import uuid
from collections.abc import Iterable
from pathlib import Path

import boto3

from app.config import settings

_UNSAFE_IN_KEY = re.compile(r"[^A-Za-z0-9._-]+")

MOCK_UPLOAD_ID = "mock-upload"


def _client():
    """Return a boto3 S3 client for the configured region and endpoint."""
    return boto3.client(
        "s3",
        region_name=settings.aws_region,
        endpoint_url=settings.s3_endpoint_url or None,
    )


def _stubbed() -> bool:
    """Whether there is no object store, so the upload helpers return placeholders."""
    return settings.s3_stub


# ── Keys ───────────────────────────────────────────────────────────────────────────────────────


def submission_key(submission_id: uuid.UUID | str, label: str) -> str:
    """Object key for a submission's uploaded zip.

    The label is slugified rather than interpolated straight in. It is user input, and a
    ``/`` or a ``..`` in it would put the object outside the submission's own prefix —
    somewhere the uploader chose. Uniqueness comes from ``submission_id``; the label is
    only there to make a bucket listing readable, so mangling it costs nothing.
    """
    slug = _UNSAFE_IN_KEY.sub("-", label).strip("-._")[:80]
    return f"submissions/{submission_id}/{slug or 'submission'}.zip"


# ── Uploads ────────────────────────────────────────────────────────────────────────────────────


def create_multipart(key: str, content_type: str = "application/zip") -> str:
    """Start a multipart upload and return its id.

    Nothing is stored at ``key`` until :func:`complete_multipart`; this reserves the upload.

    Parameters
    ----------
    key : str
        Destination object key inside the submissions bucket.
    content_type : str
        ``Content-Type`` the completed object will carry.

    Returns
    -------
    str
        The ``UploadId`` every part and the completion call must quote.
    """
    if _stubbed():
        return MOCK_UPLOAD_ID

    response = _client().create_multipart_upload(
        Bucket=settings.s3_bucket, Key=key, ContentType=content_type
    )
    return response["UploadId"]


def presign_parts(key: str, upload_id: str, part_numbers: Iterable[int]) -> dict[int, str]:
    """Presign a ``PUT`` URL per part number.

    Parameters
    ----------
    key : str
        Destination object key.
    upload_id : str
        The id :func:`create_multipart` returned.
    part_numbers : Iterable[int]
        Part numbers to sign for. 1-based, at most 10,000 per upload.

    Returns
    -------
    dict[int, str]
        ``{part_number: url}``, each valid for ``s3_part_expiry`` seconds.
    """
    if _stubbed():
        return {
            number: f"mock-s3://{settings.s3_bucket}/{key}?part={number}" for number in part_numbers
        }

    client = _client()
    return {
        number: client.generate_presigned_url(
            "upload_part",
            Params={
                "Bucket": settings.s3_bucket,
                "Key": key,
                "UploadId": upload_id,
                "PartNumber": number,
            },
            ExpiresIn=settings.s3_part_expiry,
        )
        for number in part_numbers
    }


def complete_multipart(key: str, upload_id: str, parts: list[tuple[int, str]]) -> None:
    """Assemble the uploaded parts into the object at ``key``.

    Parameters
    ----------
    key : str
        Destination object key.
    upload_id : str
        The id :func:`create_multipart` returned.
    parts : list[tuple[int, str]]
        ``(part_number, etag)`` for every part, in any order. S3 rejects a completion whose
        parts are not ascending, so they are sorted here.
    """
    if _stubbed():
        return

    _client().complete_multipart_upload(
        Bucket=settings.s3_bucket,
        Key=key,
        UploadId=upload_id,
        MultipartUpload={
            "Parts": [{"PartNumber": number, "ETag": etag} for number, etag in sorted(parts)]
        },
    )


def abort_multipart(key: str, upload_id: str) -> None:
    """Discard an unfinished multipart upload and the parts it has stored.

    Parts of an upload that is never completed or aborted are billed and do not appear in a
    normal bucket listing.
    """
    if _stubbed():
        return

    _client().abort_multipart_upload(Bucket=settings.s3_bucket, Key=key, UploadId=upload_id)


def list_parts(key: str, upload_id: str) -> dict[int, str]:
    """Return ``{part_number: etag}`` for the parts already stored, for a resumed upload.

    Paginated: ``ListParts`` answers 1,000 parts at a time.
    """
    if _stubbed():
        return {}

    client = _client()
    paginator = client.get_paginator("list_parts")

    stored: dict[int, str] = {}
    for page in paginator.paginate(Bucket=settings.s3_bucket, Key=key, UploadId=upload_id):
        for part in page.get("Parts", []):
            stored[part["PartNumber"]] = part["ETag"]

    return stored


def submission_size(s3_key: str) -> int | None:
    """Size of a submission's assembled object in bytes.

    ``None`` when there is no object store to ask, so a caller enforcing a size limit skips
    it rather than inventing a number.
    """
    if _stubbed():
        return None

    return _client().head_object(Bucket=settings.s3_bucket, Key=s3_key)["ContentLength"]


def delete_submission(s3_key: str) -> None:
    """Delete a submission's object, for one that failed validation."""
    if _stubbed():
        return

    _client().delete_object(Bucket=settings.s3_bucket, Key=s3_key)


# ── Downloads ──────────────────────────────────────────────────────────────────────────────────


def download_submission(s3_key: str, dest: Path) -> Path:
    """Download a submission zip from S3 to ``dest``."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    _client().download_file(settings.s3_bucket, s3_key, str(dest))
    return dest


def download_ground_truth(suites: Iterable[str], dest_dir: Path) -> Path:
    """Materialise the ground truth for ``suites`` under ``dest_dir``.

    If ``s3_gt_prefix`` is a local directory it is used as-is (returned directly), already
    being in the layout below.

    The bucket nests a suite level the scorers do not expect — ``{prefix}/ts1/ts1-choice/…``
    against their ``{gt_dir}/{flat_task}/{recording_id}/ground_truth.safetensors`` — so each
    suite's prefix is stripped as it is downloaded, landing every suite in one
    flat-task-rooted tree. Flat task ids carry their own suite, so suites cannot collide.

    Parameters
    ----------
    suites : Iterable[str]
        Suites to fetch, e.g. ``{"ts1", "ts3"}``. Only these are downloaded.
    dest_dir : Path
        Local directory to populate.

    Returns
    -------
    Path
        Root ground-truth directory to pass to the scorers.
    """
    local = Path(settings.s3_gt_prefix)
    if local.is_dir():
        return local

    root = settings.s3_gt_prefix.rstrip("/")
    client = _client()
    paginator = client.get_paginator("list_objects_v2")

    for suite in suites:
        prefix = f"{root}/{suite}"
        for page in paginator.paginate(Bucket=settings.s3_bucket, Prefix=prefix):
            for obj in page.get("Contents", []):
                key = obj["Key"]
                rel = key[len(prefix) :].lstrip("/")
                target = dest_dir.joinpath(rel)
                target.parent.mkdir(parents=True, exist_ok=True)
                client.download_file(settings.s3_bucket, key, str(target))

    return dest_dir
