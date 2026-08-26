import { apiFetch } from "./client.js";

// ─── API ────────────────────────────────────────────────────────────────────

// The public leaderboard: one entry per model, carrying its newest public score for each
// task and the rank it earned. The collapsing is the server's, because it is what the
// ranks are computed over — see app/ranking.py.
//
// No auth: this is the one endpoint the app serves to anonymous visitors, which is also
// why every formatter downstream escapes what it interpolates.
//
// Returns undefined on failure rather than throwing, matching modelApi/teamApi — the
// callers already treat a falsy result as "show the error state".
/**
 * @param filters {isPretrained}. Anything left undefined is not sent, which is what "no
 *                filter" means to the endpoint — an omitted parameter, not an empty one.
 *
 * The filters are the server's business rather than the table's because the ranks come back
 * computed over whatever survives them: narrowing in the browser would leave every rank
 * describing a field that is no longer on screen.
 */
async function getLeaderboard({ isPretrained } = {}) {
  const params = new URLSearchParams();

  if (isPretrained != null && isPretrained !== "") {
    params.set("is_pretrained", isPretrained);
  }

  const query = params.size ? `?${params}` : "";

  try {
    return await apiFetch(`/api/leaderboard${query}`);
  } catch (err) {
    console.error(err);
  }
}

export { getLeaderboard };
