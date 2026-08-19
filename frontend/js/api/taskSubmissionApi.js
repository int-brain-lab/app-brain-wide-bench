import { apiFetch } from "./client.js";

// ─── API ────────────────────────────────────────────────────────────────────
// Get the field options used to configure task submissions
// TODO RENAME
async function getTaskSubmissionFields() {
    return await apiFetch("/api/meta/enums");
}


// Get the available tasks
async function getTaskSuites() {
    return await apiFetch("/api/tasks");
}

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
  getTaskSubmissionFields,
  getTaskSuites,
  updateTaskSubmissions,
  getMyTaskSubmissions
};