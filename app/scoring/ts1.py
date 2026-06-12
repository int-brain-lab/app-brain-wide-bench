"""TS1 scorer: thin OOP wrapper over ``core.scoring.ts1_scoring``."""

import zipfile
from collections import defaultdict
from pathlib import Path

import numpy as np

from app.scoring.base import BaseScorer


class TS1Scorer(BaseScorer):
    """Score TS1 submissions against the ground-truth oracle.

    Delegates all numerical work to :func:`core.scoring.ts1_scoring.score_dir` and
    :func:`~core.scoring.ts1_scoring.summarize`, then flattens the tuple-keyed
    summary into a JSON-serialisable structure (see :class:`app.schemas.scoring.TS1ScoreResult`).
    """

    def extract(self, zip_path: Path, dest_dir: Path) -> Path:
        """Extract the submission zip and return the prediction root.

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

    def score(self, pred_dir: Path, gt_dir: Path) -> dict:
        """Score predictions and return a JSON-serialisable result dict."""
        from core.scoring.ts1_scoring import score_dir, summarize

        raw = score_dir(pred_dir, gt_dir)
        summary = summarize(raw)  # {(label, task, recording_id): {metric: (mean, sem, n)}}

        rows = []
        per_task_primary: dict[str, list[float]] = defaultdict(list)
        for (label, task, recording_id), metrics in sorted(summary.items()):
            rows.append(
                {
                    "label": label,
                    "task": task,
                    "recording_id": recording_id,
                    "metrics": {
                        name: {"mean": mean, "sem": sem, "n": n}
                        for name, (mean, sem, n) in metrics.items()
                    },
                }
            )
            primary = self._primary_metric(task)
            if primary in metrics:
                per_task_primary[task].append(metrics[primary][0])

        task_summary = {}
        for task, means in per_task_primary.items():
            n = len(means)
            task_summary[task] = {
                "mean": float(np.mean(means)),
                "sem": float(np.std(means, ddof=1) / np.sqrt(n)) if n > 1 else None,
                "n": n,
            }

        return {"rows": rows, "summary": task_summary}

    @staticmethod
    def _primary_metric(flat_task: str) -> str:
        """Return the primary metric name for a flat task id (e.g. ``ts1-choice``)."""
        from ts1 import get_readout_spec

        return get_readout_spec(flat_task.split("-", 1)[1]).primary_metric
