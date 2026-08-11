import { apiFetch } from "../api.js";

// ─── API ────────────────────────────────────────────────────────────────────

// The public leaderboard: every public, completed submission with its per-task
// primary-metric means. One entry per submission, not per model — the grouping into one
// row per (model, team) is leaderboardTable.js's job.
//
// No auth: this is the one endpoint the app serves to anonymous visitors, which is also
// why every formatter downstream escapes what it interpolates.
//
// Returns undefined on failure rather than throwing, matching modelApi/teamApi — the
// callers already treat a falsy result as "show the error state".
async function getLeaderboard() {
  try {
    return await apiFetch("/api/leaderboard");
  } catch (err) {
    console.error(err);
  }
}


export { getLeaderboard };
