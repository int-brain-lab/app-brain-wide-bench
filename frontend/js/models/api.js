import { apiFetch } from "../api.js";

// ─── API ────────────────────────────────────────────────────────────────────

// The public model directory: every model with its team name and a
// visibility-scoped submission count. For "models I can submit against" use
// getMyModels() — that one is scoped by the caller's token, not by a filter.
async function getModels() {
  try {
    return await apiFetch("/api/models");
  } catch (err) {
    console.error(err);
  }
}


async function getMyModels() {
  try {
    return await apiFetch("/api/users/me/models");
  } catch (err) {
    console.error(err);
  }
}


async function loadModel(modelId) {
  try {
    return await apiFetch(`/api/models/${modelId}`);
  } catch (err) {
    console.error(err);
  }
}


async function updateModel(state) {

  const modelId = state.id;

  try {
    return await apiFetch(`/api/models/${modelId}`, {
      method: "PATCH",
      body: JSON.stringify(buildPayload(state)),
    });

  } catch (err) {
    console.error(err);
  }
}


async function createModel(state) {

  try {
    return await apiFetch("/api/models", {
      method: "POST",
      body: JSON.stringify(buildPayload(state)),
    });
  } catch (err) {
    console.error(err);
  }
}


function buildPayload(state) {
  return {
    ...state,
    name: state.name.trim(),
  };
}


async function loadTeams() {
  try {
    return await apiFetch("/api/users/me/teams");
  } catch (err) {
    console.error(err);
  }
}

export { getModels, getMyModels, loadModel, updateModel, createModel, loadTeams };