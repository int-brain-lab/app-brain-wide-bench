import { apiFetch } from "../api.js";

// ─── API ────────────────────────────────────────────────────────────────────

// Every team. Public on the server — team names are already on the leaderboard.
async function getTeams() {
  try {
    return await apiFetch("/api/teams");
  } catch (err) {
    console.error(err);
  }
}


// Only the caller's teams. A separate endpoint, not a filter on /api/teams —
// its scoping comes from the token.
async function getMyTeams() {
  try {
    return await apiFetch("/api/users/me/teams");
  } catch (err) {
    console.error(err);
  }
}


// One team with its member and model counts. `members` comes back as null unless
// the caller is in the team — counts are public, names and emails aren't.
async function loadTeam(teamId) {
  try {
    return await apiFetch(`/api/teams/${teamId}`);
  } catch (err) {
    console.error(err);
  }
}


// The three writes below are deliberately not wrapped in try/catch: the server's
// message is the useful part — a duplicate name, an email that hasn't signed in
// yet, the last-member refusal — and the forms show it. Swallowing the error here
// would read as success.
async function createTeam(name) {
  return apiFetch("/api/teams", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}


// Any member may rename a team — UserTeam carries no role, so there's no owner to
// check against. The server rejects a blank or duplicate name, and the editor shows
// that message.
async function updateTeam(teamId, patch) {
  return apiFetch(`/api/teams/${teamId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}


async function addTeamMember(teamId, email) {
  return apiFetch(`/api/teams/${teamId}/members`, {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}


// 204 on success, so apiFetch resolves with null rather than a body.
async function removeTeamMember(teamId, userId) {
  return apiFetch(`/api/teams/${teamId}/members/${userId}`, {
    method: "DELETE",
  });
}


export { getTeams, getMyTeams, loadTeam, createTeam, updateTeam, addTeamMember, removeTeamMember };
