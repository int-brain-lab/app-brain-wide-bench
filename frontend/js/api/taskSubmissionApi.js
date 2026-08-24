import { apiFetch } from "./client.js";

// ─── API ────────────────────────────────────────────────────────────────────

// The field options and the task list used to live here, as /api/meta/enums and a second
// copy of /api/tasks. Both are in the one /api/meta document now — see api/metaApi.js.

// Update multiple taskSubmissions at once. `updates` is sent as given — which keys the
// server accepts is the schema's business, so the caller shapes the body with
// taskPayload() rather than this module reaching into TASK_FIELDS.
async function updateTaskSubmissions(submissionId, taskSubmissionIds, updates) {

  return await apiFetch(`/api/submissions/${submissionId}/tasks`, {
    method: "PATCH",
    body: JSON.stringify({ task_submission_ids: taskSubmissionIds, updates }),
  });
}

async function getMyTaskSubmissions() {
  return await apiFetch("/api/users/me/task-submissions");
}





export {
  updateTaskSubmissions,
  getMyTaskSubmissions
};