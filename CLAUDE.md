# Agent guide

## Backend

When working in `app/`, `tests/`, `alembic/` or `scripts/`, read
`docs/backend/styling_guidelines.md` first — module layout, import order, naming families for
endpoints/helpers/schemas, the comment and docstring limits, and the test conventions.

## Frontend

When working in `frontend/`, read these files first:

- `docs/frontend/README.md` — overview, structure, and doc map
- `docs/frontend/specifications.md` — function naming rules
- `docs/frontend/styling_guidelines.md` — file structure, comments, JSDoc, and formatting conventions
- `docs/frontend/render_guidelines.md` — when to use `core/render.js` helpers and when to suggest new ones

For the build itself — Vite, the Docker stage, cache headers — read `docs/frontend/build.md`.
Ordinary frontend edits do not need it.

These files are complementary:
- `README.md` gives the overview and points to the others
- `specifications.md` defines naming contracts
- `styling_guidelines.md` defines surface style
- `render_guidelines.md` defines DOM-write helper usage

## `_todo` files

Highlighted points of work to do are held in files ending `_todo`.

These are not the first files to read for conventions. Use them after the relevant guide files when
you want the current cleanup or refactor work for that area.

- `docs/frontend/specifications_todo.md` — current naming mismatches and suggested renames
- `docs/frontend/style_structure_todo.md` — formatting, render-helper, and likely layer/folder cleanup work
- `docs/deletion_plan_todo.md` — deleting a submission, a model or a team: the cascade each
  one carries, where the delete button goes and why, and the confirm card
- `docs/backend_caching_plan_todo.md` — HTTP caching on the API: what `/api/meta` now does and why,
  the deploy-order bug that lets `_document` go stale, and the open questions for the leaderboard
- `docs/frontend_bundle_plan_todo.md` — the record behind `docs/frontend/build.md`: the measured
  cost of the unbundled tree, the case for Vite over esbuild, and the options ruled out. Applied;
  kept for the reasoning, not as work outstanding
- `docs/leaderboard_optimisation_plan_todo.md` — where the 55 ms in `GET /api/leaderboard` goes,
  and the Redis response-cache design the measurements point to
- `docs/upload_lifecycle_todo.md` — every way a submission's file can stall, fail or be
  abandoned: the state it leaves behind, what the code does about it now, and the eleven
  decisions outstanding, plus the open points carried over from the validation plan
- `docs/worker_disk_plan_todo.md` — what a 10 GB submission costs the worker's scratch space,
  why that space currently shares a filesystem with Postgres, and the fixes in order of value


