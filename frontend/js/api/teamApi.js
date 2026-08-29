import { apiFetch } from "./client.js";
import { normalizeObject, trimmed } from "../core/validation.js";

// ─── PAYLOADS ────────────────────────────────────────────────────────────────
function buildTeamPayload(state) {
  return normalizeObject(state, { name: trimmed });
}

// ─── API ─────────────────────────────────────────────────────────────────────

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

// The role is sent rather than left to the server: only an owner can manage membership,
// so which role a new member gets is a decision, not a default to inherit silently.
async function addTeamMember(teamId, email, role) {
  return await apiFetch(`/api/teams/${teamId}/members`, {
    method: "POST",
    body: JSON.stringify({ email, role }),
  });
}

async function updateTeamMember(teamId, userId, role) {
  return await apiFetch(`/api/teams/${teamId}/members/${userId}`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
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
  updateTeamMember,
  removeTeamMember,
};
