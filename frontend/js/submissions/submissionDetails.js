import { createDetailEditor } from "../utils/detail-editor.js";
import {loadSubmissionFields, SUBMISSION_PANELS} from "./submissionSchema.js";
import {loadSubmission, updateSubmission} from "./submissionApi.js";
import {formatDate} from "../utils.js";
import {panelGroups, renderDisplayFields, renderGroups} from "../utils/form-fields.js";


// ─── RENDERING ──────────────────────────────────────────────────────────────

function renderHeader(submission) {
  document.getElementById("submission-title").textContent = submission.label;
  document.getElementById("submission-description").textContent =
    `${submission.team_name} · Updated ${formatDate(submission.updated_at)}`;
}

function renderBackLink(submission) {
  const link = document.getElementById("back-to-submission");

  link.textContent = `← Back to ${submission.label}`;
  link.href = `/html/submissions/submission_dashboard.html?id=${encodeURIComponent(submission.id)}`;
}

function renderDetails(submission, fields) {
  document.getElementById("submission-details").innerHTML =
    renderGroups(panelGroups(fields, SUBMISSION_PANELS), submission, fields, renderDisplayFields);
}


// ─── EVENTS ─────────────────────────────────────────────────────────────────

// The draft is sent as-is: SUBMISSION_FIELDS marks everything the server won't accept
// as `editable: false`, and createFieldState drops those keys — so the payload already
// matches SubmissionUpdate, which declares `extra="forbid"`.
function attachEditor(submission, fields) {

  createDetailEditor({
    container: document.getElementById("submission-details"),
    editButton: document.getElementById("edit-submission"),
    saveButton: document.getElementById("save-submission"),
    cancelButton: document.getElementById("cancel-submission"),
    record: submission,
    fields,
    groups: () => panelGroups(fields, SUBMISSION_PANELS, { columns: 1 }),
    save: draft => updateSubmission(submission.id, draft),
    onSaved: () => renderDetails(submission, fields),
    onCancel: () => renderDetails(submission, fields),
  }).attach();
}


async function loadSubmissionDetailsPage() {
      const submissionId = new URLSearchParams(location.search).get("id");
      const submission = await loadSubmission(submissionId);
      const fields = await loadSubmissionFields();

      renderHeader(submission);
      renderBackLink(submission);
      renderDetails(submission, fields);
      attachEditor(submission, fields);

      globalThis.lucide?.createIcons?.();
}

loadSubmissionDetailsPage()
