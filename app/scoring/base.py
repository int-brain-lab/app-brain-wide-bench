"""Abstract base class for task scorers."""

from abc import ABC, abstractmethod
from pathlib import Path


class BaseScorer(ABC):
    """Pure scoring interface: no S3, no DB, no Celery.

    Implementations are fully unit-testable against local files.
    """

    @abstractmethod
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
        """

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
