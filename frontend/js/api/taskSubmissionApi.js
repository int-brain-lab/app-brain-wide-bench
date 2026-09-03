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

// The per-recording breakdown is only on the detail response — see TaskScoreDetail. A task
// submission read through the model or submission that owns it carries its score's summary and
// how it was produced, and nothing per recording.
async function loadTaskSubmission(submissionId, taskSubmissionId) {
  return await apiFetch(
    `/api/submissions/${submissionId}/tasks/${taskSubmissionId}`,
  );
}

async function getMyTaskSubmissions() {
  return await apiFetch("/api/users/me/task-submissions");
}

// Every one the viewer may see: the tasks of public submissions, plus their own teams' where
// there is a session.
async function getTaskSubmissions() {
  return await apiFetch("/api/task-submissions");
}

export {
  getMyTaskSubmissions,
  getTaskSubmissions,
  loadTaskSubmission,
  updateTaskSubmissions,
};
