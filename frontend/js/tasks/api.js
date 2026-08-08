import { apiFetch } from "../api.js";

async function loadTrainingFields() {
  try {
    return await apiFetch("/api/meta/enums");
  } catch (err) {
    console.error(err);
    return {};
  }
}


// The static task catalogue: id, suite, type and the primary metric's *name*
// (TaskScoreOut carries only the value, so a score can't be labelled without this).
// Returns [] on failure — a caller shows tasks with an unlabelled metric rather
// than nothing at all.
async function getTasks() {
  try {
    return await apiFetch("/api/tasks/");
  } catch (err) {
    console.error(err);
    return [];
  }
}

export { loadTrainingFields, getTasks };