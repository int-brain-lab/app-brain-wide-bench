import { apiFetch } from "../api.js";

// ─── API ────────────────────────────────────────────────────────────────────

async function getSubmissions() {
  try {
    return await apiFetch(`/api/submissions`);
  } catch (err) {
    console.error(err);
  }
}



async function loadSubmission(submissionId) {
  try {
    return await apiFetch(`/api/submissions/${submissionId}`);
  } catch (err) {
    console.error(err);
  }
}


// The id goes in the URL only — SubmissionUpdate declares extra="forbid", so
// repeating it in the body would be a 422.
//
// Deliberately not wrapped in try/catch: the Details tab editor reports the
// failure, and swallowing it here would read as a successful save.
async function updateSubmission(submissionId, patch) {
  return apiFetch(`/api/submissions/${submissionId}`, {
    method: "PATCH",
    body: JSON.stringify(buildPayload(patch)),
  });
}


async function loadTaskSubmission(submissionId, taskSubmissionId) {
  try {
    return await apiFetch(`/api/submissions/${submissionId}/tasks/${taskSubmissionId}`);
  } catch (err) {
    console.error(err);
  }
}


// One call rather than N, so the server applies all of them or none — a loop of
// single-row PATCHes can fail partway and leave a suite half-updated.
//
// Resolves to the updated rows, which is what lets the caller name the tasks that
// actually changed instead of echoing back what it asked for.
//
// Not wrapped in try/catch, same as the single-row version below: the editor reports
// the failure, and swallowing it here would look like a successful save.
async function updateTaskSubmissions(submissionId, taskSubmissionIds, patch) {
  return apiFetch(`/api/submissions/${submissionId}/tasks`, {
    method: "PATCH",
    body: JSON.stringify({ task_submission_ids: taskSubmissionIds, updates: patch }),
  });
}


// Deliberately not wrapped in try/catch: the task editor reports the failure to the
// user, and swallowing it here would look like a successful save.
async function updateTaskSubmission(submissionId, taskSubmissionId, patch) {
  return apiFetch(`/api/submissions/${submissionId}/tasks/${taskSubmissionId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}



// A submission's name field is `label`, not `name` — this previously read
// `state.name.trim()` and threw on undefined for every call.
function buildPayload(state) {
  return {
    ...state,
    label: state.label?.trim(),
  };
}


function buildPresignPayload(state, taskSection) {
  return {
    team_id: state.team_id,
    model_id: state.model_id,
    label: state.label.trim(),
    is_public: state.is_public,
    narrative_public: state.narrative_public,
    narrative_private: state.narrative_private,
    tasks: taskSection.payloads(),
  };
}



// ─── SUBMIT FLOW ────────────────────────────────────────────────────────────

async function presignSubmission(state, taskSection) {
  const payload = buildPresignPayload(state, taskSection);
  return apiFetch("/api/submissions/presign", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function uploadToPresignedUrl(uploadUrl, file) {
  if (uploadUrl.startsWith("mock-s3://")) {
    return;
  }

  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "application/zip",
    },
    body: file,
  });

  if (!response.ok) {
    throw new Error(`Upload failed (${response.status})`);
  }
}

async function submitSubmission(submissionId) {
  return apiFetch(`/api/submissions/${submissionId}/submit`, {
    method: "POST",
  });
}


export {
  getSubmissions,
  loadSubmission,
  updateSubmission,
  loadTaskSubmission,
  updateTaskSubmission,
  updateTaskSubmissions,
  presignSubmission,
  uploadToPresignedUrl,
  submitSubmission,
};