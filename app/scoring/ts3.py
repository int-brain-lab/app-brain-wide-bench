"""TS3 scorer: thin OOP wrapper over ``core.scoring.ts3_scoring``."""

from pathlib import Path

import numpy as np

from app.scoring.base import BaseScorer

TASK = "ts3-cosmos"  # only TS3 task
PRIMARY_METRIC = "macro/f1-score"


class TS3Scorer(BaseScorer):
    """Score TS3 submissions against the ground-truth oracle.

    Unlike TS1/TS2, TS3 classifies the whole held-out unit population at once
    rather than per-recording, so rows are keyed by label only.
    """

    def score(self, pred_dir: Path, gt_dir: Path) -> dict:
        """Score predictions and return a JSON-serialisable result dict."""
        from ibl_bwb_eval.scoring.ts3 import score_dir, summarize

        raw = score_dir(pred_dir, gt_dir)
        summary = summarize(raw)  # {label: {metric: (mean, sem, n)}}

        rows = [
            {
                "label": label,
                "task": TASK,
                "metrics": {
                    name: {"mean": mean, "sem": sem, "n": n}
                    for name, (mean, sem, n) in metrics.items()
                },
            }
            for label, metrics in sorted(summary.items())
        ]

        means = [row["metrics"][PRIMARY_METRIC]["mean"] for row in rows if PRIMARY_METRIC in row["metrics"]]
        task_summary = {}
        if means:
            n = len(means)
            task_summary[TASK] = {
                "mean": float(np.mean(means)),
                "sem": float(np.std(means, ddof=1) / np.sqrt(n)) if n > 1 else None,
                "n": n,
            }

        return {"rows": rows, "summary": task_summary}
