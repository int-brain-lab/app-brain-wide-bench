"""Score a submission zip locally against ground truth without a running server.

Usage
-----
    uv run python examples/score_local.py
    uv run python examples/score_local.py --zip path/to/submission.zip --gt path/to/ts1

The default zip is the mlp-baseline fixture included in tests/fixtures/.
The default ground truth path is ~/Documents/datadisk/brain-wide-bench/ts1.
"""

import argparse
import json
import tempfile
from pathlib import Path

from app.scoring import get_scorer

DEFAULT_ZIP = Path(__file__).parent.parent / "tests" / "fixtures" / "sample.zip"
DEFAULT_GT = Path.home().joinpath("Documents", "datadisk", "brain-wide-bench", "ts1")


def main() -> None:
    parser = argparse.ArgumentParser(description="Score a TS1 submission locally.")
    parser.add_argument("--zip", type=Path, default=DEFAULT_ZIP, help="Path to submission .zip")
    parser.add_argument("--gt", type=Path, default=DEFAULT_GT, help="Path to ground-truth directory")
    args = parser.parse_args()

    if not args.zip.exists():
        raise FileNotFoundError(f"Submission zip not found: {args.zip}")
    if not args.gt.exists():
        raise FileNotFoundError(f"Ground-truth directory not found: {args.gt}")

    scorer = get_scorer("ts1")

    with tempfile.TemporaryDirectory() as tmp:
        pred_dir = scorer.extract(args.zip, Path(tmp) / "pred")
        result = scorer.score(pred_dir, args.gt)

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()