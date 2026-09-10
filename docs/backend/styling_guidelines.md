# Backend styling guidelines

Scope: `app/`, `tests/`, `alembic/`, `scripts/`.

These rules win over the style of the file being edited. No file in `app/` is yet a clean
reference — the routers and schemas carry a lot of comment prose these rules do not allow, and
`app/routers/submissions.py` and `app/schemas/tasksubmission.py` are the furthest from them.
Bring what you touch into line; do not sweep what you do not touch.

The comment rules here are the same three the frontend uses
(`docs/frontend/styling_guidelines.md`), restated for Python. Where this doc is silent and the
frontend doc is not, follow the frontend doc.

## Touching existing code

Bring the touched surface up to these conventions, in scope of the change:

- cut comments and docstrings back to the rules below
- delete stale comments outright rather than editing around them
- fix dividers and import order in the region you are already editing
- remove dead code and unused imports the change makes redundant

Keep it proportional. If a change also tidies nearby code, say so in the summary.

## File structure

1. module docstring
2. imports
3. constants
4. `router = APIRouter(...)`, for a router
5. divider-separated sections
6. endpoints or public functions last

Section order in a router: queries and aggregates, helpers, endpoints. A second router in the
same module (`tasksubmissions.py`'s flat listing) goes under its own divider with its
endpoints beneath it.

## Imports

Three groups, blank line between: standard library, third party, `app`.

Within `app`, order low-level to high-level, matching the frontend's rule:

1. `app.config`
2. `app.database`
3. `app.auth`
4. `app.models`
5. `app.schemas.*`
6. `app.storage`
7. `app.scoring`, `app.ranking`
8. `app.tasks.*`
9. `app.routers.*`

Alphabetical within a group where the layer does not decide it. Import names, not modules,
except where the module name is the clearer reference (`import app.routers.meta as meta_router`
in `conftest.py`).

## Section dividers

Title case, padded to 100 columns (the ruff line length), one blank line above and below.

```python
# ── Helpers ────────────────────────────────────────────────────────────────────────────────────
# ── Endpoints ──────────────────────────────────────────────────────────────────────────────────
```

Real sections only. A single helper does not need one.

## Naming

### Endpoints

Function name is the operation, not the URL: `list_submissions`, `get_submission`,
`update_submission`, `create_submission`. Non-CRUD actions take the verb they are:
`submit`, `presign`, `preflight`.

### Helpers

One prefix per job. Do not use two for the same job.

| Prefix | Returns | Raises |
| --- | --- | --- |
| `_get_*` | one row | 404, and 403 for the `_as_*` variants |
| `_load_*` | a response schema, assembled | as its fetch does |
| `_check_*` | the normalised value | 4xx when invalid |
| `_validate_*` | nothing | 4xx when invalid |
| `delete_*` | nothing | 409 when a concurrent write blocks the cascade |
| `visible_*` | a boolean SQLAlchemy expression | never |
| `*_of_teams` | a boolean SQLAlchemy expression | never |
| `*_per_*` | a dict keyed by id | never |

`_get_x_as_member` / `_as_viewer` / `_as_user` name the authorisation they enforce, not the
caller. Add a variant rather than a boolean flag.

An underscore means module-private. If another module imports it, drop the underscore —
`tasksubmissions.py` currently imports `_get_submission_as_member`, which is a naming bug, not
a convention.

### Schemas

One module per record type, named after it. Within it:

| Class | Is |
| --- | --- |
| `XBase` | fields every response shares |
| `XResponse` | a list item |
| `XDetail` | one record, in full |
| `XCreate` | a request body |
| `XUpdate` | a request body, all fields optional |
| `XOut` | a nested read-only shape inside another schema |

Anything endpoint-specific is named for the endpoint: `PresignResponse`.

## Docstrings

Two registers, by layer.

**Routers, schemas, models — short form.** One summary line. Then only what a caller would get
wrong from the signature alone. Then `Raises`, one line per status.

```python
async def _get_submission_as_member(submission_id, user_id, session, *, options=()):
    """Fetch a submission, enforcing that ``user_id`` is in its team.

    Raises 404 if the submission does not exist.
    Raises 403 if the user is not a member of its team.
    """
```

Not `Raises: 404 - Not found if ...`. The status names itself.

**Library-shaped modules — numpy form.** `app/storage.py`, `app/scoring/`, `app/validation/`
are consumed like libraries, and keep `Parameters` / `Returns` / `Raises` sections. Nothing in
`app/routers/` or `app/schemas/` needs them: the signature and the field list are the
documentation.

A module docstring is one or two lines saying what the module holds. `app/routers/meta.py`'s
is four paragraphs; that is the shape to avoid.

## Comments

Three rules. Limits, not judgement calls.

### One line

One line. Two only where a second fact genuinely follows. Nothing paragraph-shaped outside a
module docstring.

### A fact, never a justification

`because`, `so`, `rather than`, `which is why`, `the whole reason` are the tell. A comment
holding one is rationale — cut it to the fact it was built around.

```python
# Bad — the reasoning that produced the code.
# No team of its own: a submission belongs to a model, and the model to a team. A
# column here would be a second copy of that answer, free to disagree with the first
# the moment a model is reassigned — so whose submission this is reads through
# ``model.team_id``, and reassignment carries the submissions by construction.
model_id: uuid.UUID = Field(foreign_key="models.id")

# Good — the fact.
# No team column: a submission's team is its model's.
model_id: uuid.UUID = Field(foreign_key="models.id")
```

Docstrings obey this too:

```python
# Bad.
"""Return an expression that is True for submissions belonging to ``team_ids``.

Through the model, because that is the only place a submission's team is recorded —
the row itself names a model, and the model names the team. One helper rather than the
subquery written out at each call site, so "whose submission is this" is answered the
same way everywhere.
"""

# Good.
"""Return an expression that is True for submissions belonging to ``team_ids``.

Reads through the model: there is no team column on a submission.
"""
```

### Only what a reader would get wrong

```python
# Wrong without it — an external constraint, invisible in the code.
# Postgres cannot use a new enum value in the transaction that adds it.

# Merely thinking — the code says this.
# One query for the whole listing rather than a membership check per row.
```

Comment only: external quirks, constraints, shapes, units, non-obvious contracts, and an
ordering that a reordering would silently break.

Never comment: rationale, history, decisions taken, alternatives rejected, what the code says.
Those belong in the plan docs (`docs/*_todo.md`) or the commit message.

### Data maps are the exception

A block describing external data a reader cannot derive from the code — `conftest.py`'s fixture
inventory — is allowed, as a table. Not as prose about what the table buys you.

## Endpoints

Parameter order: path parameters, body, `user`, `session`.

```python
@router.patch("/{submission_id}", response_model=SubmissionDetail)
async def update_submission(
    submission_id: uuid.UUID,
    body: SubmissionUpdate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> SubmissionDetail:
```

Carry both `response_model=` and the return annotation.

Check in this order: permission, then shape, then conflict. A caller with no right to the
record learns nothing about its contents from a 422.

`HTTPException(status.HTTP_404_NOT_FOUND, "Submission not found")` — positional, short, no
trailing period, no internal codes or identifiers a caller cannot act on.

## Schemas

- read schemas set `model_config = ConfigDict(from_attributes=True)`
- request bodies set `model_config = ConfigDict(extra="forbid")`
- fields fed by a relationship are `| None = None`, filled by a `from_*` classmethod, with a
  one-line comment naming it
- `model_validate` where the columns match; a `from_*` classmethod where a mapping has to be
  stated
- redaction returns a copy (`withhold_private`), never mutates

## Queries

- visibility is one reusable expression (`visible_submissions`), never rewritten per endpoint
- a listing's aggregates come from one query keyed by id (`suites_per_submission`), never a
  query per row
- eager loading lives in the fetch helper; callers pass extra `options`
- `.where(...)` narrows what is *shown*; it never widens what is visible

## Tests

### Structure

1. module docstring: `The main rules are:` and a bullet per rule the module proves
2. ids as constants pulled from the `tests.conftest` maps — never literals
3. URL builders (`submissions_url`, `tasks_url`) and body builders (`presign_body(**overrides)`)
4. response readers (`labels(response)`)
5. a divider per endpoint, `# ── GET /api/submissions/{id} ──`, with its tests beneath

One-line docstring per test, stating the rule it proves rather than the steps it takes.

Name as `test_<action>_<what it proves>`, readable as a sentence:
`test_presign_rejects_a_label_the_model_already_uses`.

### One request, several assertions

Prefer asserting everything a request proves over splitting one call across tests. A request
that returns a body worth three assertions gets three assertions.

Two requests belong in one test when they prove one rule from both sides:

```python
async def test_detail_as_non_member(seeded_client):
    """A non-member can read tasks from a public submission but not a private one."""
```

### When to split

Split when the setup differs, when the endpoint differs, or when one failure would leave it
ambiguous which rule broke. `test_detail_not_found` stays its own test: 404 for an unknown id
and 403 for a private one are different rules that happen to share a URL shape.

### Assertions

Status code first, then the body. Assert the fields the rule is about; do not snapshot whole
responses.

## Checklist

- module docstring of one or two lines
- imports in three groups, `app` ordered low to high
- constants above the first divider
- dividers title case, padded to 100
- one summary line per docstring, then only what the signature does not say
- `Raises 403 if ...`, one line per status
- numpy docstrings only in `storage` / `scoring` / `validation`
- one-line factual comments, no rationale
- helper prefix matches the table
- no underscore on anything another module imports
- requests forbid extra fields, responses read from attributes
- tests name the rule, and prove all of it they can from one request
