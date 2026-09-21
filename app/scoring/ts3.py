"""TS3 scorer: thin OOP wrapper over ``ibl_bwb_eval.scoring.ts3``."""

from pathlib import Path

from app.scoring.base import BaseScorer, to_result

TASK = "ts3-unit_cosmos"  # only TS3 task


class TS3Scorer(BaseScorer):
    """Score TS3 submissions against the ground-truth oracle.

    ``score_dir`` keys by ``(label, seed)`` alone; ``from_ts3`` puts the task back, and the
    rows carry no ``recording_id``.
    """

    def score(self, pred_dir: Path, gt_dir: Path) -> dict:
        """Score predictions and return a JSON-serialisable result dict."""
        from ibl_bwb_eval.scoring.aggregation import from_ts3
        from ibl_bwb_eval.scoring.ts3 import score_dir

        return to_result(from_ts3(score_dir(pred_dir, gt_dir), TASK))
