import { apiFetch } from "./client.js";

// ─── API ─────────────────────────────────────────────────────────────────────

// Update several task submissions at once. `updates` is sent as given: which keys the
// server accepts is the schema's business, so the caller shapes the body with
// toMethodologyValues().
async function updateTaskSubmissions(submissionId, taskSubmissionIds, updates) {
  return await apiFetch(`/api/submissions/${submissionId}/tasks`, {
    method: "PATCH",
    body: JSON.stringify({ task_submission_ids: taskSubmissionIds, updates }),
  });
}

// The methodology fields are only on the detail response: a task submission nested in a
// model or a submission carries its id, task and score and nothing else.
async function loadTaskSubmission(submissionId, taskSubmissionId) {
  return await apiFetch(
    `/api/submissions/${submissionId}/tasks/${taskSubmissionId}`,
  );
}

async function getMyTaskSubmissions() {
  return await apiFetch("/api/users/me/task-submissions");
}

export { loadTaskSubmission, updateTaskSubmissions, getMyTaskSubmissions };
