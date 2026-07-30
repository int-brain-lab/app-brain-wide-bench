import { apiFetch } from "../api.js";

// ─── API ────────────────────────────────────────────────────────────────────

async function getSubmissions() {
  try {
    return await apiFetch(`/api/submissions/`);
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


// Deliberately not wrapped in try/catch: the Tasks tab editor reports the failure
// to the user, and swallowing it here would look like a successful save.
async function updateTaskSubmission(submissionId, taskSubmissionId, patch) {
  return apiFetch(`/api/submissions/${submissionId}/tasks/${taskSubmissionId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}


async function createSubmission(state) {

  try {
    return await apiFetch("/api/submissions", {
      method: "POST",
      body: JSON.stringify(buildPayload(state)),
    });
  } catch (err) {
    console.error(err);
  }
}


// A submission's name field is `label`, not `name` — this previously read
// `state.name.trim()` and threw on undefined for every call.
function buildPayload(state) {
  return {
    ...state,
    label: state.label?.trim(),
  };
}


// ─── SUBMIT FLOW ────────────────────────────────────────────────────────────

async function presignSubmission(payload) {
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
  updateTaskSubmission,
  createSubmission,
  presignSubmission,
  uploadToPresignedUrl,
  submitSubmission,
};