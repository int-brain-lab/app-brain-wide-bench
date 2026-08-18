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

import { loadSubmissionFields } from "../schemas/submissionSchema.js";
import { loadModel } from "../api/modelApi.js";
import { showFailure, showMessage } from "../core/utils.js";
import { buildTaskPanel, createTaskSection } from "../widgets/taskPanel.js";
import { buildUploadPanel, createUploadSection } from "../widgets/submissionUpload.js";
import {
  createSubmission,
  presignSubmission,
  uploadToPresignedUrl,
} from "../api/submissionApi.js";
import { loadCreatePage } from "../templates/create-page.js";
import {
  pageMessage,
  showPageError,
} from "../templates/record-page.js";
import {getTaskSuites} from "../api/taskSubmissionApi.js";
import {loadTaskFields} from "../schemas/taskSubmissionSchema.js";

// Built from the context rather than declared as a constant, because panels 3 and 4 report
// their completeness by asking objects that don't exist until `setup` has run.
//
// Panel 3 refuses requires a file and that all detected tasks are valid.
function buildPanels(context) {
  return [
    {
      panel: 1,
      title: "1. Choose a submission name and the model it belongs to"
    },
    {
      panel: 2,
      title: "2. Set submission visibility and optional narratives"
    },
    {
      panel: 3,
      // The file is this panel's, not the schema's — it never renders as a field, and the
      // upload widget is what knows whether there is one.
      complete: () => Boolean(context.file) && context.unknownTaskIds.length === 0,
      build: buildUploadPanel,
      title: "3. Upload a zip file and detect tasks"
    },
    {
      panel: 4,
      complete: () => context.taskPanel?.allConfirmed(),
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
    // state.team_id = null;
    // state.model_name = null;
    taskSection.setModel(null);
    return;
  }

  try {
    const model = await loadModel(modelId);

    // state.team_id = model.team_id;
    // state.model_name = model.name;

    taskSection.setModel(model);
  } catch (error) {
    console.error(error);

    // state.team_id = null;
    // state.model_name = null;

    // Clear the task section's model too, or it would keep methodology options from a
    // previously selected model.
    taskSection.setModel(null);

    showFailure(pageMessage(), "Loading model details failed.", error);
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

    showFailure(
      pageMessage(),
      "Loading the task list failed — task validation is unavailable.",
      error,
    );

    return new Map();
  }
}

// ─── SUBMIT ─────────────────────────────────────────────────────────────────

// Three server round-trips, each with its own progress line, so the messaging stays here
// rather than in the form — only this page knows how far along it is. The form catches a
// throw, reports it and re-arms the button.
async function submitSubmission(state, taskSection) {

  // TODO better way to handle this
  // Pass in uploadPanel and store the file in this.
  const file = state.file;
  delete state.file;

  const presigned = await presignSubmission(state, taskSection);

  showMessage(pageMessage(), "Uploading file…");

  await uploadToPresignedUrl(presigned.upload_url, file);

  await createSubmission(presigned.submission_id);

  return `/html/submissions/submissions.html`
    + `?id=${encodeURIComponent(presigned.submission_id)}&view=details&created`;
}

// ─── INITIALISATION ─────────────────────────────────────────────────────────

// `unknownTaskIds` and `taskPanel` start empty here and are filled in by `setup` and by the
// upload panel's `onFile`; the panels close over the context so they read them as they are
// at the moment a lock is applied, not as they were at page load.
async function loadSubmissionContext() {
  const fields = await loadSubmissionFields();

  if (!fields.model_id.options.length) {
    showPageError("You have no models yet — a model is required to submit.");
    return null;
  }

  const knownTasks = await loadKnownTasks();
  await loadTaskFields();

  return { fields, knownTasks, unknownTaskIds: [], taskPanel: null, file: null };
}

// The task section owns panel 4, the upload section panel 3; both are built here, between
// the form's `initialise()` and `attach()`, so a form re-render can't destroy their
// listeners.
async function setupPanels(form, context) {
  const { knownTasks } = context;

  context.taskPanel = createTaskSection({
    taskSuites: knownTasks,
    onChange: () => form.refresh(),
  });

  context.taskPanel.attach();

  const uploadPanel = createUploadSection({
    knownTasks,
    // When a file is uploaded update both the submission form state and the task panel with the detected tasks.
    onFile: (file, taskIds) => {
      // A catalogue that failed to load can't judge anything, so nothing is unknown.
      context.unknownTaskIds = knownTasks.size
        ? taskIds.filter(id => !knownTasks.has(id))
        : [];

      // Onto the context for panel 3's `complete`, and onto the state because that is where
      // submitSubmission reads it from. Neither is a field the form draws, so no redraw is
      // owed here — the lock is re-evaluated by the `refresh()` at the end of this path.
      context.file = file;
      form.state.file = file;

      // Only ids the catalogue recognises reach the task panel — which is why it has no
      // handling for one that it doesn't. Panel 3 stays incomplete until they all are.
      context.taskPanel.setTasks(context.unknownTaskIds.length ? [] : taskIds);
    },
  });

  uploadPanel.attach();

  await preselectModel(form.state, context.fields, context.taskPanel);
}

loadCreatePage({
  noun: "submission",
  backTo: { href: "/html/submissions/submission_list.html", text: "← Back to submissions" },
  load: loadSubmissionContext,
  fields: context => context.fields,
  panels: buildPanels,
  setup: setupPanels,
  submit: (state, context) => submitSubmission(state, context.taskPanel),
  onChange: async (key, value, cleared, { form, context }) => {
    if (key === "model_id") {
      await loadSelectedModel(form.state.model_id, form.state, context.taskPanel);
    }
  },
});
