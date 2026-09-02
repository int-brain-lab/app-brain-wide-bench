import { apiFetchOptional } from "./client.js";

// ─── API ─────────────────────────────────────────────────────────────────────

// A list is sent as one repeated parameter — `?training_paradigm=a&training_paradigm=b` — which
// is what FastAPI reads as a list. Empty and absent are the same thing here: an omitted
// parameter is what the endpoint reads as "no filter".
function appendFilter(params, key, value) {
  if (Array.isArray(value)) {
    for (const one of value) params.append(key, one);

    return;
  }

  if (value != null && value !== "") params.set(key, value);
}

/**
 * The public leaderboard: one entry per model, its newest public score per task, and the rank
 * it earned. No auth — the one endpoint served to anonymous visitors.
 *
 * @param filters what to narrow the field to: `pretrained`, and a list per methodology field.
 *                Filtering is the server's because the ranks come back computed over whatever
 *                survives it — a model's position is against the models it is shown beside.
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
    appendFilter(params, key, value);
  }

  const query = params.size ? `?${params}` : "";

  return await apiFetchOptional(`/api/leaderboard${query}`);
}

export { getLeaderboard };
