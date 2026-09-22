"""TS2 scorer: thin OOP wrapper over ``ibl_bwb_eval.scoring.ts2``."""

from pathlib import Path

from app.scoring.base import BaseScorer, to_result

PRIMARY_METRIC = "poisson_d2"  # Poisson deviance R² (D²), the headline TS2 metric


class TS2Scorer(BaseScorer):
    """Score TS2 submissions against the ground-truth oracle.

    Same result shape as :class:`~app.scoring.ts1.TS1Scorer`; TS2's metrics
    (``poisson_d2``, ``bps``) are fixed rather than per-task.
    """

    def score(self, pred_dir: Path, gt_dir: Path) -> dict:
        """Score predictions and return a JSON-serialisable result dict."""
        from ibl_bwb_eval.scoring.ts2 import score_dir

        return to_result(score_dir(pred_dir, gt_dir))
