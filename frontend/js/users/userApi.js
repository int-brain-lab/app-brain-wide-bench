import { apiFetch } from "../api.js";

// ─── API ────────────────────────────────────────────────────────────────────

async function loadMe() {
  try {
    return await apiFetch("/api/users/me");
  } catch (err) {
    console.error(err);
  }
}


// Deliberately not wrapped in try/catch: the settings form shows the server's
// message, and swallowing the error here would read as a successful save.
async function updateMe(patch) {
  return apiFetch("/api/users/me", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}


// Find users by name or email, for the team-create member picker. The server requires
// at least two characters and caps how many it returns, so this is a picker rather than
// a way to page through the directory.
//
// Returns [] on failure rather than throwing: the search runs on every keystroke, and a
// transient error shouldn't put an error banner under a field the user is still typing
// in. An empty result reads the same as "no matches", which is the honest fallback.
async function searchUsers(query, limit = 10) {
  try {
    const params = new URLSearchParams({ q: query, limit: String(limit) });

    return await apiFetch(`/api/users?${params}`);
  } catch (err) {
    console.error(err);
    return [];
  }
}


export { loadMe, updateMe, searchUsers };
