import { apiFetch } from "./client.js";

// ─── API ────────────────────────────────────────────────────────────────────

// The benchmark's task table: every task, its suite and the metric it is scored in.
//
// Static reference data rather than anyone's results — the same eleven rows for every
// caller, signed in or not — so it is the authority on which columns a scores table has,
// in place of sniffing the task ids on whatever rows happened to come back.
//
// Returns undefined on failure rather than throwing, matching the other read helpers; the
// callers already treat a falsy result as "show the error state".
async function getTasks() {
  try {
    return await apiFetch("/api/tasks");
  } catch (err) {
    console.error(err);
  }
}

export { getTasks };
