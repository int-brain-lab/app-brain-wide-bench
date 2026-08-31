import { apiFetchOptional } from "./client.js";

// ─── API ─────────────────────────────────────────────────────────────────────

/**
 * The public leaderboard: one entry per model, its newest public score per task, and the
 * rank it earned. No auth — the one endpoint served to anonymous visitors.
 *
 * @param isPretrained narrow to pretrained models, or not. Omit for no filter: an absent
 *                     parameter is what the endpoint reads as "no filter", not an empty
 *                     one. Filtering is the server's because the ranks come back computed
 *                     over whatever survives it.
 *
 * @returns the entries, or undefined on failure — callers treat a falsy result as the
 *          error state.
 */
async function getLeaderboard({ isPretrained } = {}) {
  const params = new URLSearchParams();

  if (isPretrained != null && isPretrained !== "") {
    params.set("is_pretrained", isPretrained);
  }

  const query = params.size ? `?${params}` : "";

  return await apiFetchOptional(`/api/leaderboard${query}`);
}

export { getLeaderboard };
