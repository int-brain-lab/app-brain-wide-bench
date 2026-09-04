"""Guards on the metadata the forms are built from.

The descriptions in ``models.py`` are the only source of the help text the create and edit
forms show, and nothing reads them by attribute — ``/api/meta`` walks the mappings — so a
key that names no field, or a member with no description, is silently a missing tooltip
rather than an error. These are the checks that make co-locating the wording with the
column actually mean something.
"""


import pytest

from app.models import DescribedEnum, Model, Submission, TaskSubmission

DESCRIBED_MODELS = [Model, Submission, TaskSubmission]

# Every DescribedEnum in the module, found rather than listed, so a new one is covered
# without this file being touched.
DESCRIBED_ENUMS = [
    obj
    for obj in vars(__import__("app.models", fromlist=["_"])).values()
    if isinstance(obj, type)
    and issubclass(obj, DescribedEnum)
    and obj is not DescribedEnum
]


@pytest.mark.parametrize("model", DESCRIBED_MODELS, ids=lambda m: m.__name__)
def test_field_descriptions_name_real_fields(model):
    """A typo'd key would otherwise just mean a tooltip that never appears."""
    assert not set(model.FIELD_DESCRIPTIONS) - set(model.model_fields)


@pytest.mark.parametrize("model", DESCRIBED_MODELS, ids=lambda m: m.__name__)
def test_field_descriptions_are_not_columns(model):
    """``ClassVar`` is what keeps the mapping out of the table — assert it, since dropping
    the annotation would turn it into a column and the failure would surface as a
    migration mismatch far from here."""
    assert "FIELD_DESCRIPTIONS" not in model.model_fields
    assert "FIELD_DESCRIPTIONS" not in {column.name for column in model.__table__.columns}


def test_described_enums_found():
    """The parametrised tests below pass trivially if the discovery above breaks."""
    assert len(DESCRIBED_ENUMS) == 5


@pytest.mark.parametrize("described_enum", DESCRIBED_ENUMS, ids=lambda e: e.__name__)
def test_every_member_has_a_description(described_enum):
    assert [member.name for member in described_enum if not member.description.strip()] == []


@pytest.mark.parametrize("described_enum", DESCRIBED_ENUMS, ids=lambda e: e.__name__)
def test_member_values_are_plain_strings(described_enum):
    """``__new__`` must leave the value the bare string and not the ``(value, description)``
    tuple: the enum columns, the API payloads and every ``== "spikes"`` in the app depend on
    it, and a mistake here breaks all of them at once."""
    for member in described_enum:
        assert isinstance(member.value, str)
        # Not str(member): Enum.__str__ shadows str.__str__ and gives "Modality.spikes",
        # which is true of a plain `str, enum.Enum` too. Equality and .value are what the
        # app actually relies on.
        assert member == member.value
        assert described_enum(member.value) is member
