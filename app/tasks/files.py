"""Getting a submission's predictions onto local disk, for the tasks that read them."""

from pathlib import Path

from app.config import settings
from app.scoring import BaseScorer
from app.storage import download_submission, is_stubbed, submission_file_exists


def materialise(s3_key: str, tmpdir: Path) -> Path:
    """Return the prediction root for ``s3_key``, downloading and extracting if needed.

    Two local paths come before the download. A key naming a directory is used in place,
    which is how the baseline submissions loaded from a fixture are read. And with no
    object store there was no upload to read back, so ``stub_submission_dir`` stands in for
    it — the whole task still runs, over a submission the developer put there rather than
    the one the form chose.

    Parameters
    ----------
    s3_key : str
        The submission's key, or a local directory standing in for one.
    tmpdir : Path
        Scratch directory for the download and the extraction.

    Returns
    -------
    Path
        Root directory under which ``seed_*.safetensors`` files are found.

    Raises
    ------
    FileNotFoundError
        Stubbed with no readable ``stub_submission_dir``, which leaves nothing to read.
    ValueError
        The downloaded object is not a zip, or holds no prediction files.
    """
    local = Path(s3_key)
    if local.is_dir():
        return local

    if is_stubbed():
        stub = Path(settings.stub_submission_dir) if settings.stub_submission_dir else None

        if stub is None or not stub.is_dir():
            raise FileNotFoundError(
                f"No object store, and stub_submission_dir is not a directory: "
                f"{settings.stub_submission_dir!r}"
            )

        return stub

    zip_path = download_submission(s3_key, tmpdir.joinpath("submission.zip"))
    return BaseScorer.extract(zip_path, tmpdir.joinpath("pred"))


def is_available(s3_key: str) -> bool:
    """Whether :func:`materialise` would find predictions to read.

    The same three branches in the same order, so a caller checking before it queues work
    and the task doing the work cannot disagree. Both local branches answer for the
    filesystem of whichever process asks, which is the worker's only when the two share it.
    """
    if Path(s3_key).is_dir():
        return True

    if is_stubbed():
        stub = settings.stub_submission_dir

        return bool(stub) and Path(stub).is_dir()

    return submission_file_exists(s3_key)
