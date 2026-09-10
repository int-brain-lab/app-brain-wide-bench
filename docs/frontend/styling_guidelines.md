# Frontend styling guidelines

Reference: `frontend/js/templates/`

When formatting, documenting, or structuring a file, match `js/templates/` first.

## Touching existing code

When editing existing code, bring the touched surface up to the current conventions within the
scope of the change.

That includes:
- rewriting or removing stale comments and JSDoc
- moving common DOM writes onto `core/render.js` helpers where practical
- fixing section dividers and file surface style in the touched area
- removing dead code, unused imports, and obsolete local patterns made unnecessary by the edit

Keep the cleanup proportional to the change. Do not sweep unrelated files or untouched regions.

If the change also brings nearby code up to the current style, mention that in your summary so the
diff holds no surprises.

## File structure

Use this order unless there is a strong reason not to:

1. short lead file comment
2. imports
3. constants
4. divider-separated sections
5. main exported function(s)
6. one trailing `export { ... }` block

Typical section order:
- configuration / constants
- helpers
- rendering / markup
- events
- lifecycle / bootstrap

## Imports

Group imports from lower-level modules to higher-level modules:
- `core`
- `api`
- `schemas`
- `utils`
- `plots`
- `tables`
- `cards`
- `components`
- `widgets`
- `templates`

Within a group, keep imports alphabetical where practical.

## Comparing siblings

When several files do the same job for different record types or views, compare them against each
other before changing one in isolation.

Work in this order:
1. shape — functions defined, order, and exports
2. contracts — signatures, option names, defaults, and argument order
3. truth — dead code, stale comments, or names that no longer match reality
4. surface — comments, JSDoc, dividers, and formatting

Lead with real behavioral or contract differences before surface tidy-ups.

## Section dividers

Use padded 80-column dividers for real sections only.

```js
// ─── CONFIGURATION ───────────────────────────────────────────────────────────
// ─── RENDERING ───────────────────────────────────────────────────────────────
// ─── EVENTS ──────────────────────────────────────────────────────────────────
```

Rules:
- one blank line above and below
- use only for meaningful sections
- inside long functions, use the same form indented to the current level

## Rows of things

Where a builder takes a list of items, a nested list means those items share one row.

Examples:

```js
buildHeader([[COMPARE_ACTION], [EDIT_ACTION, CREATE_ACTION]]);

buildSections([
  STATS_SECTION,
  { id: "ranking", title: "Ranking" },
  [detailsSection, submissionsSection],
]);
```

Where a row needs layout options, use an object with booleans rather than a class name.

```js
const unevenRow = { sections: [details, submissions], uneven: true };
const alignedRow = { sections: TEAM_SECTIONS, stretch: false };
```

Rows do not nest.

## Lead file comments

Start the file with a short comment that says:
- what the module is
- what it owns
- optionally what it does not own

Good shape:

```js
// Record details view.
//
// Renders the read-only fields and attaches the editor when allowed.
// The page owns the surrounding layout; the editor owns the form.
```

## Comments

Three rules. They are limits, not judgement calls — apply them as written.

### One line

One line per comment. Two only where a second fact genuinely follows. Nothing paragraph-shaped
anywhere except a file's lead comment.

### A fact, never a justification

A comment states a fact about the world. It does not argue for the code.

`so`, `because`, `rather than`, `which is why`, `the whole reason` are the tell. A comment
containing one is nearly always rationale: delete it, or cut it back to the fact it was built
around.

```js
// Bad — the reasoning that produced the code.
// The URL and the fetch together, because a URL naming one field beside a board showing
// another is the one state this must never be in, which is the whole reason this is not two
// calls at each of the buttons.

// Good — the fact.
// The URL and the fetch together: the two must never name different fields.
```

### Only what a reader would get wrong

Comment what a reader would get *wrong* without it, not what would make them think.

```js
// Wrong without it — an external quirk, invisible in the code.
// Tabulator builds asynchronously; the footer is looked up per write.

// Merely thinking — the code says this.
// Both halves are rendered in one call, since they are one set of values.
```

Comment only: external quirks, constraints, shapes, units, non-obvious contracts.

Never comment: rationale, history, discussion outcomes, what the code already says.

### While editing

Read the surrounding old comments too. Rewrite or remove any that no longer hold, and bring
touched comments into line with these rules.

The pull to match a file's own comment density is the failure mode to watch: a heavily
commented file makes an over-commented addition read as correct. The rules win over the
neighbours.

## JSDoc

Use JSDoc for non-trivial functions, especially ones taking an options object.
Short positional helpers need no JSDoc.

Preferred structure:
- one lead line
- blank line
- `@param` lines in destructuring order
- blank line
- `@returns`

Example:

```js
/**
 * A list in its two views, cards and a table, over one set of rows and one filter bar.
 *
 * @param container      element, or the id of one.
 * @param rows           every row, already mapped.
 * @param createCards    () => a card grid. Omit for a table-only list.
 * @param createTable    ({ rows, selection }) => { element, table }.
 * @param filterControls (rows) => controls for the bar. Omit for no filter bar.
 *
 * @returns { element, destroy }. `element` is already placed in `container`.
 */
```

Rules:
- document option names bare — no `options.` prefix
- do not include types in `@param`
- keep descriptions lowercase
- align descriptions in one column
- describe callbacks by signature
- say what omitting an option means: `Omit for no filter bar.`
- `@returns` should name the shape, not the type

## Options objects

For non-trivial public functions:
- prefer one destructured options object
- order passed options to match destructuring order
- group related options with blank lines

Example:

```js
function loadThing({
  noun,
  title,
  description = "",

  load,
  render,

  onChange,
}) {
  // ...
}
```

## Rendering and DOM writes

Prefer the helpers in `core/render.js` over direct DOM writes:
- `renderHtml(...)`
- `clearContent(...)`
- `setText(...)`
- `refreshIcons()`

Raw DOM operations are still fine when:
- attaching real nodes
- toggling attributes or classes
- updating values not covered by the helpers

## Exports

Use one trailing export block.

Preferred:

```js
export { loadListPage };
```

Avoid inline exported function declarations when possible.

## Spacing

- use blank lines between logical groups
- use blank lines around section dividers
- avoid dense blocks of unrelated statements
- avoid adding vertical space where there is no structural change

## Short checklist

- short lead comment
- grouped imports
- constants first
- divider-separated sections
- short factual comments only
- JSDoc only for non-trivial functions
- params in destructuring order
- `Omit for ...` phrasing for optional options
- use `core/render.js` helpers for common DOM writes
- one trailing `export { ... }` block

