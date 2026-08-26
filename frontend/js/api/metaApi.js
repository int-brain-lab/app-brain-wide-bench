import { apiFetch } from "./client.js";

// ─── API ────────────────────────────────────────────────────────────────────

// Everything the forms need that isn't anyone's data: the dropdown options and their help
// text, the per-field help text, the task table, and what each suite predicts. Public — a
// create page renders its dropdowns before anyone signs in.
//
// One document rather than a fetch per schema because this is a multi-page app: the three
// separate calls it replaces were each paid again on every navigation.

// Memoised per page load, and only per page load: every link here is a full navigation,
// which discards this module along with the rest of the graph. What it saves is the several
// callers *within* one page — a schema resolving its options, a widget wanting the suite
// map — making one request instead of three.
//
// Across navigations the repeat request is answered 304 from the browser's own cache, off
// the ETag the endpoint sends. That is deliberately where the cross-page caching lives
// rather than in sessionStorage here, so a reworded description is live on the next page
// load instead of waiting out a stored copy.
//
// `inflight` and not just `cached` because two callers awaiting concurrently would both
// miss an unresolved `cached` and fetch twice — the same reason client.js memoises
// `authReady`.
let cached = null;
let inflight = null;

async function getMeta() {
  cached ??= await (inflight ??= apiFetch("/api/meta"));

  return cached;
}

export { getMeta };
