"""Which models, and which of their entries, a leaderboard request asks for.

The filters arrive in two grains, and the difference between them is the whole of this
module:

``model``
    ``is_pretrained`` and the two pretraining modality lists are columns on ``Model``, so
    they decide whether a model is in the field at all.

``task``
    the five methodology fields are columns on ``TaskSubmission``, so they decide which of a
    model's entries survive. A model can stay on the board carrying only some of its tasks,
    which is why these are matched against entries rather than against submissions.

Matched in Python rather than in SQL. The four multi-valued columns are ``JSONB`` on
Postgres, where ``?|`` would express "any of these" in one clause — but the test suite
builds its schema on SQLite, whose JSON has no containment operator, so a SQL predicate
could not be tested where the behaviour lives. The public set is loaded in full either way,
because ranking needs every score's recordings; see the note in routers/leaderboard.py.

Three rules, the same for every filter:

* a filter naming no values narrows nothing
* a filter naming several matches *any* of them
* a null field matches nothing — an unanswered question is not a "no", which is the rule
  ``is_pretrained`` has always followed
"""

from typing import Any, Iterable

from app.models import Model, TaskSubmission


def _values(wanted: Iterable[Any]) -> set:
    """The values asked for, as what they compare to.

    A query parameter arrives as an enum member and a stored one comes back as the string it
    was written as. Both compare equal today — every member's name is its value — so this
    unwraps rather than relying on that holding.
    """
    return {getattr(one, "value", one) for one in wanted}


def _has(value: Any, wanted: Iterable[Any]) -> bool:
    """One answer against the values asked for."""
    if not wanted:
        return True

    if value is None:
        return False

    return getattr(value, "value", value) in _values(wanted)


def _overlaps(value: Iterable[Any] | None, wanted: Iterable[Any]) -> bool:
    """A list answer against the values asked for: any in common.

    Overlap rather than containment: ticking two modalities asks for entries that used
    *either*, matching how every other filter reads. An empty list is an answer — "none of
    them" — and matches no value asked for, the same as an absent one.
    """
    if not wanted:
        return True

    return bool(_values(value or ()) & _values(wanted))


def matches_model(
    model: Model,
    *,
    is_pretrained: Iterable[Any] = (),
    pretrained_in_modalities: Iterable[Any] = (),
    pretrained_out_modalities: Iterable[Any] = (),
) -> bool:
    """Whether this model belongs in the field the board ranks over."""
    return (
        _has(model.is_pretrained, is_pretrained)
        and _overlaps(model.pretrained_in_modalities, pretrained_in_modalities)
        and _overlaps(model.pretrained_out_modalities, pretrained_out_modalities)
    )


def matches_entry(
    entry: TaskSubmission,
    *,
    extra_input_modality: Iterable[Any] = (),
    training_paradigm: Iterable[Any] = (),
    supervision_regime: Iterable[Any] = (),
    calibration: Iterable[Any] = (),
    finetuning_strategy: Iterable[Any] = (),
) -> bool:
    """Whether this entry is one of the results the board is asked to show."""
    return (
        _overlaps(entry.extra_input_modality, extra_input_modality)
        and _has(entry.training_paradigm, training_paradigm)
        and _has(entry.supervision_regime, supervision_regime)
        and _has(entry.calibration, calibration)
        and _overlaps(entry.finetuning_strategy, finetuning_strategy)
    )
