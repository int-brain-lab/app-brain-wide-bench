import { apiFetch } from "./client.js";
import { buildQuery } from "./params.js";
import { normalizeObject, trimmed } from "../core/validation.js";

// ─── PAYLOADS ────────────────────────────────────────────────────────────────

function buildSubmissionPayload(state) {
  return normalizeObject(state, { label: trimmed });
}

function buildSubmitPayload(state, taskSection) {
  const payload = buildSubmissionPayload(state);

  // Fixed at create, and refused here: validation reached its verdict under it.
  delete payload.is_deterministic;

  return { ...payload, tasks: taskSection.payloads() };
}

// ─── API ─────────────────────────────────────────────────────────────────────

// `teamId` narrows the list to one team, for its own page. Visibility is unchanged by it:
// the endpoint still answers with what this caller may see.
async function getSubmissions(teamId) {
  return await apiFetch(`/api/submissions${buildQuery({ team_id: teamId })}`);
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

// The last of the steps: create, upload the parts, complete, then this. Takes the id
// create returned rather than form state, unlike createModel and createTeam.
async function finaliseSubmission(submissionId, state, taskSection) {
  return await apiFetch(`/api/submissions/${submissionId}/submit`, {
    method: "POST",
    body: JSON.stringify(buildSubmitPayload(state, taskSection)),
  });
}

// ─── UPLOAD ──────────────────────────────────────────────────────────────────

// Group A of the validator over the zip's own entry list, before a byte is sent. Advisory:
// the authoritative run happens on the server once the file has arrived.
async function prevalidateEntries(entries, isDeterministic) {
  return await apiFetch("/api/submissions/prevalidate", {
    method: "POST",
    body: JSON.stringify({ entries, is_deterministic: isDeterministic }),
  });
}

// Creates the submission and starts its upload, or picks up the caller's own unfinished
// attempt at the same label. Either way it answers with every part still owed.
async function createSubmission(state, fileSize) {
  return await apiFetch("/api/submissions", {
    method: "POST",
    body: JSON.stringify({
      ...buildSubmissionPayload(state),
      file_size: fileSize,
    }),
  });
}

// The recovery read: what S3 already holds, plus a fresh signature per part named.
async function getUpload(submissionId, partNumbers = []) {
  const query = buildQuery({ parts: partNumbers });

  return await apiFetch(`/api/submissions/${submissionId}/upload${query}`);
}

async function completeUpload(submissionId, parts) {
  return await apiFetch(`/api/submissions/${submissionId}/upload/complete`, {
    method: "POST",
    body: JSON.stringify({ parts }),
  });
}

// Abandons the submission and whatever it holds — stored parts, or the object they were
// assembled into. Refused once it is being validated or has been submitted for scoring.
async function deleteSubmission(submissionId) {
  return await apiFetch(`/api/submissions/${submissionId}`, {
    method: "DELETE",
  });
}

// ─── VALIDATION ──────────────────────────────────────────────────────────────

async function getValidation(submissionId) {
  return await apiFetch(`/api/submissions/${submissionId}/validation`);
}

export {
  completeUpload,
  createSubmission,
  deleteSubmission,
  finaliseSubmission,
  getMySubmissions,
  getSubmissions,
  getUpload,
  getValidation,
  loadSubmission,
  prevalidateEntries,
  updateSubmission,
};
