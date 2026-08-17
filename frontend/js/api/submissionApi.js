import { apiFetch } from "./client.js";


// ─── PAYLOADS ────────────────────────────────────────────────────────────────────

function buildSubmissionPayload(state) {
  return {
    ...state,
    label: state.label?.trim(),
  };
}

function buildPresignPayload(state, taskSection) {
  return {
    ...buildSubmissionPayload(state),
    tasks: taskSection.payloads(),
  };
}

// ─── API ────────────────────────────────────────────────────────────────────

async function getSubmissions() {
  return await  apiFetch(`/api/submissions`);
}


async function getMySubmissions() {
  return await apiFetch(`/api/users/me/submissions`);
}


async function loadSubmission(submissionId) {
  return await apiFetch(`/api/submissions/${submissionId}`);
}


async function updateSubmission(submissionId, patch) {
  return await apiFetch(`/api/submissions/${submissionId}`, {
    method: "PATCH",
    body: JSON.stringify(buildSubmissionPayload(patch)),
  });
}


async function presignSubmission(state, taskSection) {
  return await apiFetch("/api/submissions/presign", {
    method: "POST",
    body: JSON.stringify(buildPresignPayload(state, taskSection)),
  });
}


async function createSubmission(submissionId) {
  return await apiFetch(`/api/submissions/${submissionId}/submit`, {
    method: "POST",
  });
}

// ─── UPLOAD FILE ────────────────────────────────────────────────────────────

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

export {
  getSubmissions,
  getMySubmissions,
  loadSubmission,
  updateSubmission,
  presignSubmission,
  uploadToPresignedUrl,
  createSubmission
};