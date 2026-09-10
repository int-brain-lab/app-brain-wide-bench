# `core/render.js` guidelines

Reference: `frontend/js/core/render.js`

Use the shared render helpers where they fit. Do not hand-write the same DOM update pattern in each feature.

## Use the existing helpers first

Prefer these helpers over direct DOM writes:

- `renderHtml(container, html, { show, refresh })`
  - use instead of `innerHTML = ...`
  - use when replacing a region with markup
- `clearContent(container, { hide })`
  - use instead of `replaceChildren()` when clearing a region
- `setText(container, text)`
  - use instead of `textContent = ...` for plain text
- `refreshIcons()`
  - use instead of direct `lucide.createIcons()` calls
- `getElement(id)`
  - use for optional `id` lookups

## Prefer helper calls over local wrappers

If a file is only wrapping one of these helpers with no added contract, call the shared helper directly.

Keep a local wrapper only when it adds something real, for example:
- a feature-specific default
- a stable public surface for another module
- a meaningful domain operation beyond the raw DOM write

## Leave direct DOM operations for cases the helpers do not cover

Direct DOM work is still fine when:
- attaching real nodes with `appendChild` or `replaceChildren(node)`
- toggling classes, attributes, or `hidden`
- updating styles or geometry
- working with focus, selection, or measurements
- updating form values or widget APIs

## Add to `render.js` when a DOM-write pattern repeats

When the same DOM update pattern appears in several files, prefer a new shared helper over repeating it.

Strong candidates for a new helper are patterns that:
- appear in more than one feature
- use the same DOM operation and the same options
- carry the same ownership rule each time
- would otherwise encourage more raw `innerHTML`, `textContent`, or clearing code

Examples of patterns worth extracting:
- write HTML and then unhide
- clear content and then hide
- write HTML and refresh icons
- write text and toggle visibility from whether it is empty

## Rule while editing

When touching code that writes to the DOM:
1. check whether `render.js` already has the helper you need
2. switch to that helper where practical
3. if the same raw DOM pattern appears repeatedly, propose or add a new shared helper
4. keep the helper generic; keep domain wording in the caller

## Keep helper boundaries small

Helpers in `render.js` should stay generic and mechanical.

They should describe:
- what is written
- what is cleared
- whether something is shown or hidden
- whether shared visual refresh is needed

They should not encode:
- page-specific wording
- record-specific behavior
- API or state logic

## Short checklist

- use `renderHtml` for HTML replacement
- use `clearContent` for emptying a region
- use `setText` for plain text
- use `refreshIcons` for icon refreshes
- avoid raw DOM writes when a shared helper already exists
- suggest a new helper when the same DOM-write pattern repeats across files

