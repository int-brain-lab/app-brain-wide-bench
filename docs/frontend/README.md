# Frontend overview

Static multi-page frontend for Brain-Wide Bench, implemented with plain HTML, CSS, and browser ES modules.

## What this directory holds

Production frontend files still live in `frontend/`:
- `frontend/index.html`
- `frontend/html/`
- `frontend/css/`
- `frontend/js/`

This `docs/frontend/` directory holds the working conventions for editing that code.

## Read these first

When working in `frontend/`, read these docs in this order:

1. `docs/frontend/README.md` — overview, structure, and doc map
2. `docs/frontend/specifications.md` — function naming rules
3. `docs/frontend/styling_guidelines.md` — file structure, comments, JSDoc, and formatting rules
4. `docs/frontend/render_guidelines.md` — when to use `core/render.js` helpers and when to suggest new ones

`docs/frontend/build.md` describes how the frontend is bundled and served. Read it when
touching the build, the Dockerfile, or cache headers; not needed for ordinary frontend edits.

Highlighted cleanup work is tracked separately in `_todo` files:
- `docs/frontend/specifications_todo.md`

## Frontend shape

### Page model

- HTML entrypoints live in `frontend/html/` plus `frontend/index.html`
- each page loads browser ES modules from `frontend/js/`
- pages are static documents enhanced in the browser
- shared record-style pages use helpers in `frontend/js/templates/`
- routed record pages use `frontend/js/core/router.js`

### Directory guide

- `frontend/css/` — shared styling
- `frontend/html/` — page entrypoints
- `frontend/js/api/` — API clients and auth-aware fetch helpers
- `frontend/js/cards/` — card renderers
- `frontend/js/components/` — reusable UI building blocks
- `frontend/js/comparisons/` — shared comparison controllers and views
- `frontend/js/core/` — shared utilities, routing, render helpers, data helpers
- `frontend/js/forms/` — schema-driven form state and rendering
- `frontend/js/nav/` — top and side navigation
- `frontend/js/pages/` — page entrypoints and boot logic
- `frontend/js/plots/` — plotting helpers and chart wrappers
- `frontend/js/schemas/` — field and schema metadata
- `frontend/js/tables/` — Tabulator-backed and static tables
- `frontend/js/templates/` — shared page shells and reference style
- `frontend/js/widgets/` — stateful page-level widgets

## Data-shape rules

### Tables take `rows`, not raw records

- fetch records in the page or loader
- map them once with a nearby `to*Rows` helper
- pass the same `rows` shape to tables, cards, and filter builders

This keeps filtering, cards, and tables working over one shared shape.

The main exception is a table whose columns or row dimension are derived from the raw input
rather than from a flat row mapping.

## Runtime model

### Production

The frontend is static in production, and built:
- no Node runtime in production
- no framework, and no npm package in the browser bundle
- Vite bundles `frontend/` into `dist/`, which is what the image serves

The build is a stage in the repo `Dockerfile`, so `dist/` is never committed and Node exists
only while the image is built. `app/main.py` serves the hashed chunks under `/assets/` as
`immutable` and everything else as `no-cache`.

Runtime dependencies are loaded by HTML pages from CDN tags, not from npm:
- Auth0 SPA SDK
- Tabulator
- Chart.js
- Lucide

They are read as globals (`new Tabulator`, `globalThis.lucide`), never imported, so the bundle
has no externals to declare.

### Development tooling

Node is used here for the build and for development checks:
- Vite
- ESLint
- Prettier
- Vitest

The scripts live in `frontend/package.json`.

## Local development

Nothing under `frontend/js/` is bundler-specific — plain ES modules, no bare specifiers — so
development runs against the source and never needs a build.

To serve the static frontend locally:

```bash
cd /home/user/int-brain-lab/brain-wide-bench/app-brain-wide-bench/frontend
python -m http.server 8080
```

Adjust the port as needed for your backend setup.

To install dev dependencies:

```bash
cd /home/user/int-brain-lab/brain-wide-bench/app-brain-wide-bench/frontend
npm install
```

Common checks:

```bash
npm run lint
npm run format:check
npm test
```

To check the production bundle still builds, which is what a deploy does:

```bash
npm run build
npm run preview
```

## Editing rules at a glance

- keep cross-cutting helpers in `frontend/js/core/`
- keep API concerns in `frontend/js/api/`
- keep page boot logic small; move interaction-heavy logic into `frontend/js/widgets/`
- match `frontend/js/templates/` for style when in doubt
- use `core/render.js` helpers for common DOM writes where practical
- when touching code, bring touched comments and surface style into line with the current docs

## Related docs

- `docs/frontend/build.md`
- `docs/frontend/specifications.md`
- `docs/frontend/styling_guidelines.md`
- `docs/frontend/render_guidelines.md`
- `docs/frontend/specifications_todo.md`

