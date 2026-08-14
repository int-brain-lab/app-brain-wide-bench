import { apiFetch } from "../api.js";

// ─── PAYLOADS ────────────────────────────────────────────────────────────────────

function buildModelPayload(state) {
  return {
    ...state,
    name: state.name.trim(),
  };
}

// ─── API ────────────────────────────────────────────────────────────────────

async function getModels() {
  return await apiFetch("/api/models");
}

async function getMyModels() {
  return await apiFetch("/api/users/me/models");
}

async function loadModel(modelId) {
  return await apiFetch(`/api/models/${modelId}`);
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
  updateModel,
  createModel };