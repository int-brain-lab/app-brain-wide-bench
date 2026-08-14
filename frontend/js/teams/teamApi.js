import { apiFetch } from "../api.js";

// ─── PAYLOADS ────────────────────────────────────────────────────────────────
function buildTeamPayload(state) {
    return {
    ...state,
    name: state.name?.trim(),
  };
}

// ─── API ────────────────────────────────────────────────────────────────────

async function getTeams() {
  return await apiFetch("/api/teams");
}


async function getMyTeams() {
    return await apiFetch("/api/users/me/teams");
}


async function loadTeam(teamId) {
  return await apiFetch(`/api/teams/${teamId}`);
}


async function createTeam(state) {
  return await apiFetch("/api/teams", {
    method: "POST",
    body: JSON.stringify(buildTeamPayload(state)),
  });
}


async function updateTeam(teamId, patch) {
  return await apiFetch(`/api/teams/${teamId}`, {
    method: "PATCH",
    body: JSON.stringify(buildTeamPayload(patch)),
  });
}


async function addTeamMember(teamId, email) {
  return await apiFetch(`/api/teams/${teamId}/members`, {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}


async function removeTeamMember(teamId, userId) {
  return await apiFetch(`/api/teams/${teamId}/members/${userId}`, {
    method: "DELETE",
  });
}


export {
  getTeams,
  getMyTeams,
  loadTeam,
  createTeam,
  updateTeam,
  addTeamMember,
  removeTeamMember };
