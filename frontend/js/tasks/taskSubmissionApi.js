import { apiFetch } from "../api.js";
import {trainingFieldKeys} from "./taskSubmissionSchema.js";

// ─── PAYLOADS ────────────────────────────────────────────────────────────────────

function buildTaskSubmissionPayload(state) {
  return Object.fromEntries(trainingFieldKeys().map(key => [key, state[key]]));
}


// ─── API ────────────────────────────────────────────────────────────────────
// Get the field options used to configure task submissions
// TODO RENAME
async function getTaskSubmissionFields() {
    return await apiFetch("/api/meta/enums");
}


// Get the available tasks
async function getTaskSuites() {
    return await apiFetch("/api/tasks/");
}

// Update multiple taskSubmissions at once
async function updateTaskSubmissions(submissionId, taskSubmissionIds, state) {

  return await apiFetch(`/api/submissions/${submissionId}/tasks`, {
    method: "PATCH",
    body: JSON.stringify({ task_submission_ids: taskSubmissionIds, updates: buildTaskSubmissionPayload(state) }),
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