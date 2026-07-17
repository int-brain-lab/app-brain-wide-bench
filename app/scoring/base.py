"""Abstract base class for task scorers."""

import zipfile
from abc import ABC, abstractmethod
from pathlib import Path


class BaseScorer(ABC):
    """Pure scoring interface: no S3, no DB, no Celery.

    Implementations are fully unit-testable against local files.
    """

    def extract(self, zip_path: Path, dest_dir: Path) -> Path:
        """Extract a submission zip and return the prediction-root directory.

        Parameters
        ----------
        zip_path : Path
            Path to the uploaded ``.zip`` archive.
        dest_dir : Path
            Directory to extract into.

        Returns
        -------
        Path
            Root directory under which ``seed_*.safetensors`` files are found.

        Raises
        ------
        ValueError
            If ``zip_path`` is not a valid zip or contains no prediction files.
        """
        zip_path = Path(zip_path)
        dest_dir = Path(dest_dir)
        if not zipfile.is_zipfile(zip_path):
            raise ValueError(f"Not a valid zip archive: {zip_path}")
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(dest_dir)
        if not any(dest_dir.rglob("seed_*.safetensors")):
            raise ValueError(
                "Submission contains no 'seed_*.safetensors' prediction files "
                "in the expected <label>/<task>/<recording_id>/ layout."
            )
        return dest_dir

    @abstractmethod
    def score(self, pred_dir: Path, gt_dir: Path) -> dict:
        """Score predictions against ground truth.

        Parameters
        ----------
        pred_dir : Path
            Prediction root (the return value of :meth:`extract`).
        gt_dir : Path
            Ground-truth root.

        Returns
        -------
        dict
            JSON-serialisable score results.
        """
