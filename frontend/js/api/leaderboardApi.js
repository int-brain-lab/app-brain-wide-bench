import { apiFetchOptional } from "./client.js";
import { appendFilter, appendRange } from "./params.js";

// ─── API ─────────────────────────────────────────────────────────────────────

function isRange(value) {
  return Boolean(value) && !Array.isArray(value) && typeof value === "object";
}

/**
 * The public leaderboard: one entry per model, its newest public score per task, and the rank
 * it earned. No auth — the one endpoint served to anonymous visitors.
 *
 * @param filters what to narrow the field to: `pretrained`, a list per methodology field, and
 *                a `{ min, max }` per span. Filtering is the server's because the ranks come
 *                back computed over whatever survives it — a model's position is against the
 *                models it is shown beside.
 *
 * @returns the entries, or undefined on failure — callers treat a falsy result as the error
 *          state.
 */
async function getLeaderboard({ pretrained, ...fields } = {}) {
  const params = new URLSearchParams();

  // The one parameter whose name differs: the column is `is_pretrained` and the URL a reader
  // shares says `pretrained`. Both values is a question the endpoint can be asked — "answered
  // either way", which is narrower than no filter at all.
  appendFilter(params, "is_pretrained", pretrained);

  for (const [key, value] of Object.entries(fields)) {
    // A pair of bounds goes out as two parameters and a set of values as one repeated, so the
    // shape decides which. Read off the value rather than from a list of names kept here: what
    // a filter *is* belongs to whoever built the control, and this would be a second copy of
    // it to keep in step.
    if (isRange(value)) appendRange(params, key, value);
    else appendFilter(params, key, value);
  }

  const query = params.size ? `?${params}` : "";

  return await apiFetchOptional(`/api/leaderboard${query}`);
}

export { getLeaderboard };
