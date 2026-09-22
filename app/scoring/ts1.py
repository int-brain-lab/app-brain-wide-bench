"""TS1 scorer: thin OOP wrapper over ``ibl_bwb_eval.scoring.ts1``."""

from pathlib import Path

from app.scoring.base import BaseScorer, to_result


class TS1Scorer(BaseScorer):
    """Score TS1 submissions against the ground-truth oracle.

    Numerical work is :func:`ibl_bwb_eval.scoring.ts1.score_dir`; the result shape is
    :func:`app.scoring.base.to_result`.
    """

    def score(self, pred_dir: Path, gt_dir: Path) -> dict:
        """Score predictions and return a JSON-serialisable result dict."""
        from ibl_bwb_eval.scoring.ts1 import score_dir

        return to_result(score_dir(pred_dir, gt_dir))
