"""TS2 scorer: thin OOP wrapper over ``core.scoring.ts2_scoring``."""

from collections import defaultdict
from pathlib import Path

import numpy as np

from app.scoring.base import BaseScorer

PRIMARY_METRIC = "cohens_r2"  # Poisson deviance R² (D²), the headline TS2 metric


class TS2Scorer(BaseScorer):
    """Score TS2 submissions against the ground-truth oracle.

    Same (label, task, recording_id) row/summary shape as :class:`~app.scoring.ts1.TS1Scorer`,
    but TS2's metrics (``cohens_r2``, ``bps``) are fixed rather than per-task.
    """

    def score(self, pred_dir: Path, gt_dir: Path) -> dict:
        """Score predictions and return a JSON-serialisable result dict."""
        from core.scoring.ts2_scoring import score_dir, summarize

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
            if PRIMARY_METRIC in metrics:
                per_task_primary[task].append(metrics[PRIMARY_METRIC][0])

        task_summary = {}
        for task, means in per_task_primary.items():
            n = len(means)
            task_summary[task] = {
                "mean": float(np.mean(means)),
                "sem": float(np.std(means, ddof=1) / np.sqrt(n)) if n > 1 else None,
                "n": n,
            }

        return {"rows": rows, "summary": task_summary}
