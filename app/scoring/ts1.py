"""TS1 scorer: thin OOP wrapper over ``ibl_bwb_eval.scoring.ts1``."""

from collections import defaultdict
from pathlib import Path

import numpy as np

from app.scoring.base import BaseScorer


class TS1Scorer(BaseScorer):
    """Score TS1 submissions against the ground-truth oracle.

    Delegates all numerical work to :func:`ibl_bwb_eval.scoring.ts1.score_dir` and
    :func:`ibl_bwb_eval.scoring.aggregation.aggregate`, then flattens the tuple-keyed summary
    into a JSON-serialisable structure (see :class:`app.schemas.scoring.TS1ScoreResult`).

    ``aggregate`` is the suite's own ``summarize`` with a clip: ``r2`` and ``poisson_d2`` are
    floored at 0 per seed before the mean and SEM are taken, so a stored mean of either is a
    mean of clipped values and never negative. Metrics outside that set pass through.
    """

    def score(self, pred_dir: Path, gt_dir: Path) -> dict:
        """Score predictions and return a JSON-serialisable result dict."""
        from ibl_bwb_eval.scoring.aggregation import aggregate
        from ibl_bwb_eval.scoring.ts1 import score_dir

        raw = score_dir(pred_dir, gt_dir)
        summary = aggregate(raw)  # {(label, task, recording_id): {metric: (mean, sem, n)}}

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
        from ibl_bwb_eval.tasks.ts1 import get_ts1_readout_spec

        return get_ts1_readout_spec(flat_task.split("-", 1)[1]).primary_metric
