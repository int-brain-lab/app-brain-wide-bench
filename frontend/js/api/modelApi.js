import { apiFetch, apiFetchOptional } from "./client.js";
import { buildQuery } from "./params.js";
import { normalizeObject, trimmed } from "../core/validation.js";

// ─── PAYLOADS ────────────────────────────────────────────────────────────────

function buildModelPayload(state) {
  return normalizeObject(state, { name: trimmed });
}

// ─── API ─────────────────────────────────────────────────────────────────────

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

/**
 * A model's parameters and the task entries it stands on — see
 * GET /api/models/{id}/breakdown.
 *
 * @param taskSubmissionIds which entries to describe. Omit for the newest scored entry per
 *                          task, which is where the model stands today. Pass them when the
 *                          caller is already looking at a set of scores — a leaderboard row
 *                          names the entries it ranked, and asking for "the newest" here
 *                          could answer with a different run than the one on screen, since a
 *                          filtered board stands on the newest *matching* entry.
 */
async function loadModelBreakdown(modelId, { taskSubmissionIds } = {}) {
  const query = buildQuery({ task_submission_id: taskSubmissionIds });

  return await apiFetch(`/api/models/${modelId}/breakdown${query}`);
}

// Where a model places against the public field, and where it would place with its
// private work counted — see GET /api/models/{id}/ranking.
//
// Undefined on failure rather than throwing, matching leaderboardApi: this feeds one tile
// beside a record the page has already loaded, and losing the ranking shouldn't take the
// record down with it.
async function getModelRanking(modelId) {
  return await apiFetchOptional(`/api/models/${modelId}/ranking`);
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
  loadModel,
  loadModelBreakdown,
  getModelRanking,
  updateModel,
  createModel,
};
