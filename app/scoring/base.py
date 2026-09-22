"""Scorer base class, and the result shape every suite's ``score`` returns."""

import zipfile
from abc import ABC, abstractmethod
from pathlib import Path


class BaseScorer(ABC):
    """Pure scoring interface: no S3, no DB, no Celery.

    Implementations are fully unit-testable against local files.
    """

    @staticmethod
    def extract(zip_path: Path, dest_dir: Path) -> Path:
        """Extract a submission zip and return the prediction-root directory.

        Static, and identical for every suite: validation runs before a submission has task
        rows, so it reaches this as ``BaseScorer.extract`` with no suite to name.

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


def _entries(metrics: dict) -> dict:
    """Turn one summary's ``(mean, sem, n)`` tuples into JSON objects."""
    return {name: {"mean": mean, "sem": sem, "n": n} for name, (mean, sem, n) in metrics.items()}


def to_result(raw: dict) -> dict:
    """Flatten raw per-seed scores into the structure a ``TaskScore`` is written from.

    Parameters
    ----------
    raw : dict
        ``ibl_bwb_eval.scoring.<suite>.score_dir`` output, keyed by
        ``(label, task, recording_id, seed)`` or ``(label, task, seed)``.

    Returns
    -------
    dict
        ``rows``, one entry per (label, task, recording), each metric aggregated over that
        recording's seeds; and ``overall``, one entry per task, each metric aggregated over
        seeds with the recordings averaged within each seed first. ``r2``, ``poisson_d2``
        and ``bps`` are floored at 0 per seed in both.
    """
    from ibl_bwb_eval.scoring.aggregation import (
        NO_RECORDING_ID,
        aggregate,
        aggregate_over_seeds,
    )

    rows = []
    for (label, task, recording_id), metrics in sorted(aggregate(raw).items()):
        row = {"label": label, "task": task}
        # TS3 classifies the whole unit population at once and takes the sentinel instead.
        if recording_id != NO_RECORDING_ID:
            row["recording_id"] = recording_id
        row["metrics"] = _entries(metrics)
        rows.append(row)

    # Validation rejects a submission holding more than one label (E106).
    overall = {
        task: _entries(metrics) for (_label, task), metrics in aggregate_over_seeds(raw).items()
    }

    return {"rows": rows, "overall": overall}
