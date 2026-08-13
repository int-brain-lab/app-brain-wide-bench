// Create a new submission.
//
//   1. Model        pick a model
//   2. Information  name, visibility, narratives
//   3. Predictions  upload a zip and detect tasks
//   4. Tasks        per-task methodology
//
// Panels 3 and 4 belong to their own components — submissionUpload.js and
// taskSubmissionsCreate.js — which build their markup and bind to it. The form builds those
// fieldsets once and never refills them.

import { SUBMISSION_PANELS, loadSubmissionFields } from "./submissionSchema.js";
import { loadModel } from "../models/modelApi.js";
import { apiFetch, isAuthenticated } from "../api.js";
import { showError, showMessage } from "../utils.js";
import { createTaskSection } from "../tasks/taskSubmissionsCreate.js";
import { buildUploadPanel, createUploadSection } from "./submissionUpload.js";
import {
  presignSubmission,
  submitSubmission,
  uploadToPresignedUrl,
} from "./submissionApi.js";
import { showGate } from "../utils/gate.js";
import { createPanelForm } from "../pages/create-form.js";
import { pageMessage } from "../pages/record-page.js";

const LIST = "/html/submissions/submission_list.html";

// Panel 4's requirement is the tasks themselves, checked through `alsoRequires`.
const PANELS = [
  { panel: 1, required: ["label", "model_id"] },
  { panel: 2, required: [] },
  { panel: 3, required: ["file"], build: buildUploadPanel },
  { panel: 4, required: [], build: () => `<div id="task-panel"></div>` },
];

// ─── MODEL ──────────────────────────────────────────────────────────────────

// The selected model supplies team_id/model_name for the submission and the
// model-dependent rules used by the task methodology fields.
async function loadSelectedModel(modelId, state, taskSection) {
  if (!modelId) {
    state.team_id = null;
    state.model_name = null;
    taskSection.setModel(null);
    return;
  }

  showMessage(pageMessage(), "Loading…");

  try {
    const model = await loadModel(modelId);

    state.team_id = model.team_id;
    state.model_name = model.name;

    taskSection.setModel(model);
    showMessage(pageMessage(), "");
  } catch (error) {
    console.error(error);

    state.team_id = null;
    state.model_name = null;

    // Clear the task section's model too, or it would keep methodology options from a
    // previously selected model.
    taskSection.setModel(null);

    showError(pageMessage(), "Could not load model details.");
  }
}

// `?model=<id>` lets a caller arrive with the model already chosen. The model dashboard's
// create strip and the models page's post-create card both pass it.
//
// Validated against the picker's own options first: an id that isn't one of the caller's
// models would select nothing, leaving the dropdown blank while `state.model_id` claimed a
// value — and panel 2 would unlock against a model the server would refuse.
async function preselectModel(state, fields, taskSection) {
  const requested = new URLSearchParams(location.search).get("model");

  if (!requested) return;

  const known = fields.model_id.options.some(
    option => String(option.value) === requested,
  );

  if (!known) return;

  state.model_id = requested;

  // The same call the change handler makes, so team_id, model_name and the task panel's
  // model-dependent options end up as they would had the user picked it by hand.
  await loadSelectedModel(requested, state, taskSection);
}

// One request shared by the detected-task pills and the task section.
async function loadKnownTasks() {
  try {
    const knownTasks = await apiFetch("/api/tasks/");

    return new Map(knownTasks.map(task => [task.id, task.task_suite]));
  } catch (error) {
    console.error(error);

    showError(
      pageMessage(),
      "Could not load the list of known tasks — task validation is unavailable.",
    );

    return new Map();
  }
}

// ─── SUBMIT ─────────────────────────────────────────────────────────────────

// Three server round-trips, each with its own progress line, so the messaging stays here
// rather than in the form — only this page knows how far along it is. The form catches a
// throw, reports it and re-arms the button.
async function submitSubmissionForm(state, taskSection) {
  showMessage(pageMessage(), "Requesting upload URL…");

  const presigned = await presignSubmission(state, taskSection);

  showMessage(pageMessage(), "Uploading file…");

  await uploadToPresignedUrl(presigned.upload_url, state.file);

  showMessage(pageMessage(), "Finalising submission…");

  await submitSubmission(presigned.submission_id);

  showMessage(pageMessage(), "Submitted. Redirecting to your submission…");

  return `/html/submissions/submissions.html`
    + `?id=${encodeURIComponent(presigned.submission_id)}&view=details`;
}

// ─── INITIALISATION ─────────────────────────────────────────────────────────

async function loadSubmissionCreatePage() {
  const elements = { gate: document.getElementById("gate") };
  const container = document.getElementById("container");

  try {
    if (!(await isAuthenticated())) {
      showGate(elements, false);
      return;
    }

    showGate(elements, true);

    const fields = await loadSubmissionFields();

    if (!fields.model_id.options.length) {
      showError(container, "You have no models yet — a model is required to submit.");
      return;
    }

    // Declared before the form so `alsoRequires` can close over it, and assigned after mount
    // so it can bind to the panel the form built. Neither is called until both exist.
    let taskSection = null;

    const form = createPanelForm({
      title: "New submission",
      description: "Upload a zip of predictions to score against the held-out test data.",
      backTo: { href: LIST, text: "← Back to submissions" },
      panels: PANELS,
      schemaPanels: SUBMISSION_PANELS,
      fields,
      cancelHref: LIST,
      submitLabel: "Create submission",
      submitIcon: "upload",
      submitError: "Submission failed",
      alsoRequires: () => taskSection.allValid() && taskSection.allConfirmed(),

      onChange: async key => {
        if (key === "model_id") {
          await loadSelectedModel(form.state.model_id, form.state, taskSection);
        }
      },

      submit: state => submitSubmissionForm(state, taskSection),
    });

    // After mount, so panels 3 and 4 exist for their components to bind to.
    form.mount();

    const knownTasks = await loadKnownTasks();

    taskSection = createTaskSection({
      container: document.getElementById("task-panel"),
      onChange: () => form.refresh(),
    });

    await taskSection.initialise(knownTasks);

    createUploadSection({
      message: pageMessage(),
      knownTasks,

      // One handler for both directions: a chosen file and its task ids, or `(null, [])`
      // when it is removed. The task section owns its own rendering and notifies the form
      // through onChange, which updates the locks and the submit button.
      onFile: (file, taskIds) => {
        form.state.file = file;
        taskSection.applyDetected(taskIds);
      },
    }).attach();

    // Before the first render, so the dropdown shows the choice and panel 2 is already
    // unlocked rather than opening a moment later.
    await preselectModel(form.state, fields, taskSection);

    form.render();
    form.refresh();
    form.attach();
  } catch (error) {
    console.error("Failed to initialise the submission create page:", error);

    showError(container, "Could not load the submission form.");
  }
}

loadSubmissionCreatePage();
