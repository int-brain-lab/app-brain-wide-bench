"""Scorer factory.

Adding a new task = implement a ``BaseScorer`` subclass and register it below.
The Celery task never changes.
"""

from app.scoring.base import BaseScorer
from app.scoring.ts1 import TS1Scorer
from app.scoring.ts2 import TS2Scorer
from app.scoring.ts3 import TS3Scorer

_SCORERS: dict[str, type[BaseScorer]] = {"ts1": TS1Scorer, "ts2": TS2Scorer, "ts3": TS3Scorer}


def get_scorer(task: str) -> BaseScorer:
    """Return a scorer instance for ``task``.

    Raises
    ------
    KeyError
        If ``task`` has no registered scorer (caught and returned as HTTP 400 at
        the presign endpoint).
    """
    return _SCORERS[task]()


__all__ = ["BaseScorer", "TS1Scorer", "TS2Scorer", "TS3Scorer", "get_scorer"]
