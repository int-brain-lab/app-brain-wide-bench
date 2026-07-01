"""
Score a submission zip locally against ground truth without a running server.
"""

import json
import tempfile
from pathlib import Path

from app.scoring import get_scorer

zip_file = Path('/Users/olivier/PycharmProjects/brain-wide-bench/app-brain-wide-bench/tests/fixtures/sample.zip')
ground_truth_file = Path.home().joinpath("Documents", "datadisk", "brain-wide-bench", "ts1")

scorer = get_scorer("ts1")

with tempfile.TemporaryDirectory() as tmp:
    pred_dir = scorer.extract(zip_file, Path(tmp) / "pred")
    result = scorer.score(pred_dir, ground_truth_file)

print(json.dumps(result, indent=2))
