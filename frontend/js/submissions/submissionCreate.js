// Create a new submission.
//
// Contains 4 panels
//   1. Identity     submission name and associated model
//   2. Visibility   submission visibility and optional narratives
//   3. File         upload a zip file and detect tasks
//   4. Tasks        task parameters
//
// Panels 1 and 2 are schema-drive, panels 3 and 4 are component-driven and their markup
// and events are built and controlled via submissionUpload.js and taskSubmissionsCreate.js.

import { loadSubmissionFields } from "./submissionSchema.js";
import { loadModel } from "../models/modelApi.js";
import { isAuthenticated } from "../api.js";
import { showError, showMessage } from "../utils.js";
import { buildTaskPanel, createTaskSection } from "../tasks/taskSubmissionsCreate.js";
import { buildUploadPanel, createUploadSection } from "./submissionUpload.js";
import {
  createSubmission,
  presignSubmission,
  uploadToPresignedUrl,
} from "./submissionApi.js";
import { showGate } from "../pages/gate.js";
import { createPanelForm } from "../pages/create-form.js";
import { pageMessage } from "../pages/record-page.js";
import {getTaskSuites} from "../tasks/taskSubmissionApi.js";


// Built inside the loader rather than declared here, because panels 3 and 4 report their
// completeness by asking objects that don't exist until the page has loaded.
//
// Panel 3 refuses requires a file and that all detected tasks are valid.
function buildPanels({ allTasksValid, allTasksConfirmed }) {
  return [
    {
      panel: 1,
      required: ["label", "model_id"],
      title: "1. Choose a submission name and the model it belongs to"
    },
    {
      panel: 2,
      required: [],
      title: "2. Set submission visibility and optional narratives"
    },
    {
      panel: 3,
      required: ["file"],
      complete: () => allTasksValid(),
      build: buildUploadPanel,
      title: "3. Upload a zip file and detect tasks"
    },
    {
      panel: 4,
      required: [],
      complete: () => allTasksConfirmed(),
      build: buildTaskPanel,
      title: "4. Configure task parameters"
    },
  ];
}

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

  try {
    const model = await loadModel(modelId);

    // state.team_id = model.team_id;
    state.model_name = model.name;

    taskSection.setModel(model);
  } catch (error) {
    console.error(error);

    // state.team_id = null;
    state.model_name = null;

    // Clear the task section's model too, or it would keep methodology options from a
    // previously selected model.
    taskSection.setModel(null);

    showError(pageMessage(), "Could not load model details.");
  }
}

// When the page is called with modelId in the url, the model is pre-selected
async function preselectModel(state, fields, taskSection) {
  const requested = new URLSearchParams(location.search).get("model");

  if (!requested) return;

  const known = fields.model_id.options.some(
    option => String(option.value) === requested,
  );

  if (!known) return;

  state.model_id = requested;

  await loadSelectedModel(requested, state, taskSection);
}

// One request shared by the detected-task pills and the task section.
async function loadKnownTasks() {
  try {
    const tasks = await getTaskSuites();

    return new Map(tasks.map(task => [task.id, task.task_suite]));
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
async function submitSubmission(state, taskSection) {
  showMessage(pageMessage(), "Requesting upload URL…");

  const presigned = await presignSubmission(state, taskSection);

  showMessage(pageMessage(), "Uploading file…");

  await uploadToPresignedUrl(presigned.upload_url, state.file);

  showMessage(pageMessage(), "Finalising submission…");

  await createSubmission(presigned.submission_id);

  showMessage(pageMessage(), "Submitted. Redirecting to your submission…");

  return `/html/submissions/submissions.html`
    + `?id=${encodeURIComponent(presigned.submission_id)}&view=details`;
}

// ─── INITIALISATION ─────────────────────────────────────────────────────────

async function loadSubmissionCreatePage() {

  try {
    if (!(await isAuthenticated())) {
      showGate(false);
      return;
    }

    showGate(true);

    const submissionFields = await loadSubmissionFields();

    if (!submissionFields.model_id.options.length) {
      showError(document.getElementById("container"), "You have no models yet — a model is required to submit.");
      return;
    }

    const knownTasks = await loadKnownTasks();

    let unknownTaskIds = [];
    let taskPanel = null;

    const submissionForm = createPanelForm({
      noun: "submission",
      backTo: { href: "/html/submissions/submissions.html", text: "← Back to submissions" },
      panels: buildPanels({
        allTasksValid: () => unknownTaskIds.length === 0,
        allTasksConfirmed: () => taskPanel?.allConfirmed(),
      }),
      fields: submissionFields,
      submit: state => submitSubmission(state, taskPanel),
      onChange: async key => {
        if (key === "model_id") {
          await loadSelectedModel(
            submissionForm.state.model_id,
            submissionForm.state,
            taskPanel);
        }
      },
    });

    submissionForm.initialise();

    taskPanel = createTaskSection({
      taskSuites: knownTasks,
      onChange: () => submissionForm.refresh(),
    });

    taskPanel.attach();


    const uploadPanel = createUploadSection({
      message: pageMessage(),
      knownTasks,
      // When a file is uploaded update both the submission form state and the task panel with the detected tasks.
      onFile: (file, taskIds) => {
        // A catalogue that failed to load can't judge anything, so nothing is unknown.
        unknownTaskIds = knownTasks.size
          ? taskIds.filter(id => !knownTasks.has(id))
          : [];

        submissionForm.state.file = file;

        // Only ids the catalogue recognises reach the task panel — which is why it has no
        // handling for one that it doesn't. Panel 3 stays incomplete until they all are.
        taskPanel.setTasks(unknownTaskIds.length ? [] : taskIds);
      },
    });

    uploadPanel.attach();

    await preselectModel(submissionForm.state, submissionFields, taskPanel);

    submissionForm.attach();
  } catch (error) {
    console.error("Failed to initialise the submission create page:", error);

    showError(document.getElementById("container"), "Could not load the submission form.");
  }
}

loadSubmissionCreatePage();
