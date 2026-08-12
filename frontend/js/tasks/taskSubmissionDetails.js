// Task submission details
//
// A page showing the details for a single task submission.
//
// The page contains an edit button that allows the user to update editable fields.
// The fields and title of each panel in the page is defined in TASK_PANELS.
// Editable fields are defined in the TASK_FIELDS.
//
// Apply to suite propagates the changes made on a single task to all sibling tasks.

import { Editor } from "../utils/editor.js";
import {
  loadTaskFields,
  TASK_PANELS,
  trainingFieldKeys,
} from "./taskSubmissionSchema.js";
import {
  loadSubmission,
  loadTaskSubmission,
  updateTaskSubmissions,
} from "../submissions/submissionApi.js";
import { loadModel } from "../models/modelApi.js";
import { suiteFromTask } from "../utils/suites.js";
import {showError, showMessage} from "../utils.js";
import {
  panelGroups,
  renderDisplayFields,
  renderGroups,
} from "../utils/form-fields.js";
import { isAuthenticated } from "../api.js";
import { showGate } from "../utils/gate.js";

// ─── DOM ────────────────────────────────────────────────────────────────────

function getElements() {
  return {
    gate: document.getElementById("gate"),
    title: document.getElementById("task-title"),
    description: document.getElementById("task-description"),
    backLink: document.getElementById("back-to-tasks"),
    details: document.getElementById("task-details"),
    message: document.getElementById("task-message"),
    editButton: document.getElementById("edit-task"),
    saveButton: document.getElementById("save-task"),
    cancelButton: document.getElementById("cancel-task"),
    applyToSuite: document.getElementById("apply-to-suite"),
    applyToSuiteInput: document.getElementById("apply-to-suite-input"),
    applyToSuiteLabel: document.getElementById("apply-to-suite-label"),
  };
}

// ─── HELPERS ────────────────────────────────────────────────────────────────

function suiteLabel(taskId) {
  return suiteFromTask(taskId)?.toUpperCase() ?? null;
}

function suiteSiblings(submission, taskSubmission) {
  const suite = suiteFromTask(taskSubmission.task_id);

  return (submission.task_submissions ?? []).filter(
    sibling => suiteFromTask(sibling.task_id) === suite,
  );
}

function buildPatch(draft) {
  return Object.fromEntries(
    trainingFieldKeys().map(key => [key, draft[key]]),
  );
}

// ─── RENDERING ──────────────────────────────────────────────────────────────

function renderHeader(elements, submission, taskSubmission) {
  elements.title.textContent = taskSubmission.task_id;

  elements.description.textContent = [
    suiteLabel(taskSubmission.task_id),
    submission.label,
    submission.team_name,
  ]
    .filter(Boolean)
    .join(" · ");
}

function renderBackLink(elements, submission) {
  elements.backLink.textContent = `← Back to ${submission.label}`;
  elements.backLink.href =
    `/html/submissions/submissions.html?id=${encodeURIComponent(submission.id)}&view=tasks`;
}

function renderDetails(elements, taskSubmission, fields) {
  const groups = panelGroups(fields, TASK_PANELS);

  elements.details.innerHTML = renderGroups(
    groups,
    taskSubmission,
    fields,
    renderDisplayFields,
  );
}

function renderApplyToSuiteLabel(elements, taskSubmission, siblingCount) {
  const suite = suiteLabel(taskSubmission.task_id) ?? "matching";

  elements.applyToSuiteLabel.textContent =
    `Apply to all ${suite} tasks (${siblingCount})`;
}

// ─── APPLY TO SUITE ─────────────────────────────────────────────────────────

// Only show this element in editing mode, otherwise hide
function showApplyToSuite(elements, visible) {
  elements.applyToSuite.hidden = !visible;

  if (!visible) {
    elements.applyToSuiteInput.checked = false;
  }
}

// ─── EVENTS ─────────────────────────────────────────────────────────────────

// Names the tasks the server reports it actually updated rather than the tasks
// requested by the page.
function reportUpdated(elements, updated) {
  const names = updated
    .map(row => row.task_id)
    .sort();

  showMessage(
    elements.message,
    names.length === 1
      ? `Updated ${names[0]}.`
      : `Updated ${names.length} tasks: ${names.join(", ")}.`,
  );
}

// A single bulk update is used for both one-task and suite-wide saves. The server
// therefore remains responsible for applying the update atomically.
//
// Returns every row the server reported, not just the edited one — that list is what names
// the tasks a suite-wide save touched, and the caller narrows it for the editor.
async function saveTasks(
  draft,
  taskSubmission,
  submission,
  elements,
) {
  const targets = elements.applyToSuiteInput.checked
    ? suiteSiblings(submission, taskSubmission)
    : [taskSubmission];

  return updateTaskSubmissions(
    submission.id,
    targets.map(target => target.id),
    buildPatch(draft),
  );
}

// ─── EDITOR ─────────────────────────────────────────────────────────────────

function attachEditor(elements, taskSubmission, submission, model, fields) {

  showApplyToSuite(elements, false);

  let updated = [];

  new Editor({
    container: elements.details,
    editButton: elements.editButton,
    saveButton: elements.saveButton,
    cancelButton: elements.cancelButton,
    record: taskSubmission,
    fields,
    groups: () => panelGroups(fields, TASK_PANELS, { columns: 1 }),
    // `task_id` and `model` aren't editable fields, but TASK_FIELDS uses both as
    // context when deciding which methodology options are valid.
    context: () => ({
      task_id: taskSubmission.task_id,
      model,
    }),
    // Narrowed to the edited task because that's the record the editor assigns onto; the
    // siblings a suite-wide save also wrote aren't shown on this page.
    save: async draft => {
      updated = await saveTasks(draft, taskSubmission, submission, elements);

      return updated.find(row => row.id === taskSubmission.id) ?? updated[0];
    },
    onEdit: () => showApplyToSuite(elements, true),
    // Renders the record the editor hands back rather than the captured one. They are the
    // same object today — the editor merges with Object.assign — but relying on that ties
    // this page to an implementation detail it can't see from here.
    onSaved: saved => {
      reportUpdated(elements, updated);
      showApplyToSuite(elements, false);
      renderDetails(elements, saved, fields);
    },
    onCancel: () => {
      showApplyToSuite(elements, false);
      renderDetails(elements, taskSubmission, fields);
    },
  }).attach();
}

// ─── INITIALISATION ─────────────────────────────────────────────────────────

async function loadTaskSubmissionDetailsPage() {
  const elements = getElements();
  try {
    if (!(await isAuthenticated())) {
      showGate(elements, false);
      return;
    }

    showGate(elements, true);


    const params = new URLSearchParams(location.search);
    const submissionId = params.get("submission");
    const taskSubmissionId = params.get("task");

    if (!submissionId || !taskSubmissionId) {
      showError(
        elements.message,
        "No submission or task id in the URL.",
      );
      return;
    }

    const [taskSubmission, submission, fields] = await Promise.all([
      loadTaskSubmission(submissionId, taskSubmissionId),
      loadSubmission(submissionId),
      loadTaskFields(),
    ]);

    if (!taskSubmission) {
      showError(
        elements.message,
        `Could not load task submission ${taskSubmissionId}.`,
      );
      return;
    }

    if (!submission) {
      showError(
        elements.message,
        `Could not load submission ${submissionId}.`,
      );
      return;
    }

    // The model determines which methodology options are legal.
    // TODO: Include the model/pretraining information on the submission so this
    // additional request isn't needed.
    const model = submission?.model_id
      ? await loadModel(submission.model_id)
      : null;

    renderHeader(elements, submission, taskSubmission);
    renderBackLink(elements, submission);
    renderDetails(elements, taskSubmission, fields);
    renderApplyToSuiteLabel(
      elements,
      taskSubmission,
      suiteSiblings(submission, taskSubmission).length,
    );

    attachEditor(elements, taskSubmission, submission, model, fields);

    globalThis.lucide?.createIcons?.();
} catch (error) {
    console.error(
      "Failed to load task submission details:",
      error,
    );

    showError(
      elements.message,
      "Task submission details page could not be loaded.",
    );
  }
}

loadTaskSubmissionDetailsPage();

