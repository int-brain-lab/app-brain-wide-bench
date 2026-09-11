"""Check the bucket is configured for the submission upload flow, before deploying.

    uv run --env-file .env python scripts/check_s3.py

Exercises every S3 action the flow uses and reports the first that is refused, so a missing
IAM permission is named here rather than surfacing later inside a browser's PUT — a request
the server never sees.

Also checks that the browser would be able to read the ``ETag`` off a part upload. Without
that, every part uploads successfully and the upload can never be completed, which is the
flow's most confusing failure.

Writes one five-byte object under ``submissions/_probe/`` and deletes it again. Nothing else
in the bucket is touched.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import boto3
import urllib3  # botocore's own HTTP client, so always present

from app import storage
from app.config import settings

PROBE_KEY = "submissions/_probe/probe.zip"
PROBE_BODY = b"probe"

failures: list[str] = []


def report(what: str, ok: bool, note: str = "") -> None:
    """Record one check and print it."""
    if not ok:
        failures.append(what)

    print(f"  {'ok  ' if ok else 'FAIL'}  {what}{f'  — {note}' if note else ''}")


def put_part(url: str, origin: str) -> tuple[str | None, str | None]:
    """Upload the probe part as a browser would. Returns ``(etag, exposed_headers)``.

    ``urllib3`` rather than ``urllib.request``: a presigned URL's signature covers its query
    string exactly as written, and ``urllib.request`` does not send it verbatim — which
    comes back as ``SignatureDoesNotMatch`` and reads like a bucket problem.

    Raises
    ------
    RuntimeError
        Carrying whatever S3 said. A missing permission, a bad signature and a clock skew
        are all 403, and only the response body tells them apart.
    """
    response = urllib3.PoolManager().request(
        "PUT", url, body=PROBE_BODY, headers={"Origin": origin}
    )

    if response.status != 200:
        body = response.data.decode("utf-8", "replace")
        detail = body
        if "<Code>" in body:
            code = body.split("<Code>")[1].split("</Code>")[0]
            message = body.split("<Message>")[1].split("</Message>")[0]
            detail = f"{code}: {message}"

        raise RuntimeError(f"{response.status} {detail[:160]}")

    return response.headers.get("ETag"), {
        "allow_origin": response.headers.get("Access-Control-Allow-Origin"),
        "expose": response.headers.get("Access-Control-Expose-Headers"),
    }


def check_ground_truth() -> None:
    """The prefix must be the root holding one directory per suite, not one suite's."""
    prefix = settings.s3_gt_prefix.rstrip("/")

    if Path(prefix).is_dir():
        report("ground truth is a local directory", True, prefix)
        return

    listing = boto3.client("s3", region_name=settings.aws_region).list_objects_v2(
        Bucket=settings.s3_bucket, Prefix=f"{prefix}/", Delimiter="/"
    )
    suites = [
        entry["Prefix"].rstrip("/").rsplit("/", 1)[-1]
        for entry in listing.get("CommonPrefixes", [])
    ]

    report(
        f"ground truth under {prefix}/",
        bool(suites),
        f"suites: {suites}" if suites else "nothing there — is the prefix one suite deep?",
    )


def check_upload(origin: str) -> None:
    """Every action the upload flow needs, in the order it needs them."""
    upload_id = storage.create_multipart(PROBE_KEY)
    report("create_multipart", True)

    try:
        url = storage.presign_parts(PROBE_KEY, upload_id, [1])[1]
        etag, cors = put_part(url, origin)
        report("presigned part upload", True)

        # Whether the bucket has *no* CORS or CORS without ExposeHeaders are different
        # problems: the first stops the browser uploading at all, the second lets every part
        # through and then makes completing impossible.
        expose = cors["expose"]

        if not cors["allow_origin"]:
            note = f"no CORS on this bucket for {origin} — the browser cannot upload at all"
        elif not expose or "etag" not in expose.lower():
            note = f"CORS allows the upload but exposes {expose!r} — add ETag to ExposeHeaders"
        else:
            note = expose

        report(
            "ETag readable by the browser",
            bool(expose) and "etag" in expose.lower(),
            note,
        )

        stored = storage.list_parts(PROBE_KEY, upload_id)
        report("list_parts", stored != {}, f"{len(stored)} part(s)")

        storage.complete_multipart(PROBE_KEY, upload_id, [(1, etag)])
        upload_id = None
        report("complete_multipart", True)
    finally:
        if upload_id is not None:
            storage.abort_multipart(PROBE_KEY, upload_id)

    size = storage.submission_size(PROBE_KEY)
    report("head_object", size == len(PROBE_BODY), f"{size} bytes")

    storage.delete_submission_file(PROBE_KEY)
    report("delete_object", True)

    second = storage.create_multipart(PROBE_KEY)
    storage.abort_multipart(PROBE_KEY, second)
    report("abort_multipart", True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--origin",
        default="https://brainwidebench.iblcore.org",
        help="Origin the browser will upload from, checked against the bucket's CORS.",
    )
    args = parser.parse_args()

    if storage.is_stubbed():
        print("S3_STUB is on — there is no bucket to check.")
        return 1

    print(f"bucket: {settings.s3_bucket} ({settings.aws_region})")
    print(f"origin: {args.origin}\n")

    try:
        check_upload(args.origin)
        check_ground_truth()
    except Exception as error:  # noqa: BLE001 — the failure is the finding, not a crash
        report(type(error).__name__, False, str(error)[:200])

    if failures:
        print(f"\n{len(failures)} check(s) failed: {', '.join(failures)}")
        return 1

    print("\nEverything the upload flow needs is in place.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
