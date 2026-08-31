import { apiFetch } from "./client.js";
import { normalizeObject, trimmed } from "../core/validation.js";

// ─── PAYLOADS ────────────────────────────────────────────────────────────────

function buildSubmissionPayload(state) {
  return normalizeObject(state, { label: trimmed });
}

function buildPresignPayload(state, taskSection) {
  return {
    ...buildSubmissionPayload(state),
    tasks: taskSection.payloads(),
  };
}

// ─── API ─────────────────────────────────────────────────────────────────────

async function getSubmissions() {
  return await apiFetch(`/api/submissions`);
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

// The last of the three steps: presign, upload, then this. Takes the id presign returned
// rather than form state, unlike createModel and createTeam.
async function finaliseSubmission(submissionId) {
  return await apiFetch(`/api/submissions/${submissionId}/submit`, {
    method: "POST",
  });
}

// ─── UPLOAD FILE ─────────────────────────────────────────────────────────────

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
  finaliseSubmission,
};
