import { apiFetch } from "../api.js";

async function loadTrainingFields() {
  try {
    return await apiFetch("/api/meta/enums");
  } catch (err) {
    console.error(err);
    return {};
  }
}

export { loadTrainingFields };