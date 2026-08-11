// Submission details
//
// A page showing the details for a single submission.
//
// The page contains an edit button that allows the user to update editable fields.
// The fields and title of each panel in the page is defined in SUBMISSION_PANELS.
// Editable fields are defined in the SUBMISSION_FIELDS.

import { Editor } from "../utils/editor.js";
import {
  loadSubmissionFields,
  SUBMISSION_PANELS,
} from "./submissionSchema.js";
import {
  loadSubmission,
  updateSubmission,
} from "./submissionApi.js";
import {formatDate, showError} from "../utils.js";
import {
  panelGroups,
  renderDisplayFields,
  renderGroups,
} from "../utils/form-fields.js";


// ─── DOM ────────────────────────────────────────────────────────────────────

function getElements() {
  return {
    message: document.getElementById("form-message"),
    title: document.getElementById("submission-title"),
    description: document.getElementById("submission-description"),
    backLink: document.getElementById("back-to-submission"),
    details: document.getElementById("submission-details"),
    editButton: document.getElementById("edit-submission"),
    saveButton: document.getElementById("save-submission"),
    cancelButton: document.getElementById("cancel-submission"),
  };
}

// ─── RENDERING ──────────────────────────────────────────────────────────────

function renderHeader(submission, elements) {
  elements.title.textContent = submission.label;
  elements.description.textContent = [
    submission.team_name,
    submission.updated_at
      ? `Updated ${formatDate(submission.updated_at)}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function renderBackLink(submission, elements) {
  elements.backLink.textContent = `← Back to ${submission.label}`;
  elements.backLink.href =
    `/html/submissions/submission_dashboard.html?id=${encodeURIComponent(submission.id)}`;
}

function renderDetails(elements, submission, fields) {
  const groups = panelGroups(fields, SUBMISSION_PANELS);

  elements.details.innerHTML = renderGroups(
    groups,
    submission,
    fields,
    renderDisplayFields,
  );
}

// ─── EDITOR ─────────────────────────────────────────────────────────────────

function attachEditor(submission, fields, elements) {
  Editor({
    container: elements.details,
    editButton: elements.editButton,
    saveButton: elements.saveButton,
    cancelButton: elements.cancelButton,
    record: submission,
    fields,
    groups: () => panelGroups(fields, SUBMISSION_PANELS, { columns: 1 }),
    save: draft => updateSubmission(submission.id, draft),
    onSaved: saved => renderDetails(elements, saved, fields),
    onCancel: () => renderDetails(elements, submission, fields),
  })
    .attach();
}

// ─── INITIALISATION ─────────────────────────────────────────────────────────

async function loadSubmissionDetailsPage() {
  const elements = getElements();
  try {

    const submissionId = new URLSearchParams(location.search).get("id");

    if (!submissionId) {
      showError(
        elements.message,
        "No submission id in the URL.",
      );
      return;
    }

    const [submission, fields] = await Promise.all([
      loadSubmission(submissionId),
      loadSubmissionFields(),
    ]);


    if (!submission) {
      showError(
        elements.message,
        `Could not load submission ${submissionId}.`,
      );
      return;
    }

    renderHeader(submission, elements);
    renderBackLink(submission, elements);
    renderDetails(elements, submission, fields);
    attachEditor(submission, fields, elements);

    globalThis.lucide?.createIcons?.();
    } catch (error) {
    console.error(
      "Failed to load submission details:",
      error,
    );

    showError(
      elements.message,
      "Submission details page could not be loaded.",
    );
  }
}

loadSubmissionDetailsPage();

