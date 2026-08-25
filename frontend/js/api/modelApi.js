import { apiFetch } from "./client.js";

// ─── PAYLOADS ────────────────────────────────────────────────────────────────────

function buildModelPayload(state) {
  return {
    ...state,
    name: state.name?.trim(),
  };
}

// ─── API ────────────────────────────────────────────────────────────────────

// `teamId` narrows the list to one team, for its own page. Visibility is unchanged by it:
// the endpoint still answers with what this caller may see.
async function getModels(teamId) {
  const query = teamId ? `?team_id=${encodeURIComponent(teamId)}` : "";

  return await apiFetch(`/api/models${query}`);
}

async function getMyModels() {
  return await apiFetch("/api/users/me/models");
}

async function loadModel(modelId) {
  return await apiFetch(`/api/models/${modelId}`);
}

// Where a model places against the public field, and where it would place with its
// private work counted — see GET /api/models/{id}/ranking.
//
// Undefined on failure rather than throwing, matching leaderboardApi: this feeds one tile
// beside a record the page has already loaded, and losing the ranking shouldn't take the
// record down with it.
async function getModelRanking(modelId) {
  try {
    return await apiFetch(`/api/models/${modelId}/ranking`);
  } catch (err) {
    console.error(err);
  }
}

async function updateModel(modelId, patch) {

  return await apiFetch(`/api/models/${modelId}`, {
      method: "PATCH",
      body: JSON.stringify(buildModelPayload(patch)),
    });
}

async function createModel(state) {
  return await apiFetch("/api/models", {
    method: "POST",
    body: JSON.stringify(buildModelPayload(state)),
  });
}

export {
  getModels,
  getMyModels,
  getModelRanking,
  loadModel,
  updateModel,
  createModel };