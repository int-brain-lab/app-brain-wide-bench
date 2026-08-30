// Create a new submission.
//
// Contains 4 panels
//   1. Identity     submission name and associated model
//   2. Visibility   submission visibility and optional narratives
//   3. File         upload a zip file and detect tasks
//   4. Tasks        task parameters
//
// Panels 1 and 2 are schema-driven, panels 3 and 4 are component-driven and their markup
// and events are built and controlled via submissionUpload.js and taskPanel.js.

import { getMeta } from "../api/metaApi.js";
import { loadModel } from "../api/modelApi.js";
import {
  createSubmission,
  presignSubmission,
  uploadToPresignedUrl,
} from "../api/submissionApi.js";
import { loadSubmissionFields } from "../schemas/submissionSchema.js";
import { loadTaskFields } from "../schemas/taskSubmissionSchema.js";
import {
  buildFailureMessage,
  buildInfoMessage,
} from "../components/messages.js";
import {
  buildUploadPanel,
  createUploadSection,
} from "../widgets/submissionUpload.js";
import { buildTaskPanel, createTaskSection } from "../widgets/taskPanel.js";
import { loadCreatePage } from "../templates/createPage.js";
import { renderMessage, renderPageError } from "../templates/pageChrome.js";

// Built from the context rather than declared as a constant: panels 3 and 4 report their
// completeness by asking objects that only exist once `setup` has run.
function buildPanels(context) {
  return {
    model: {
      type: "fields",
      title: "1. Choose a submission name and the model it belongs to",
    },

    information: {
      type: "fields",
      title: "2. Set submission visibility and optional narratives",
    },

    upload: {
      type: "component",
      title: "3. Upload a zip file and detect tasks",
      build: buildUploadPanel,

      // The file is this panel's, not the schema's: it never renders as a field.
      complete: () =>
        Boolean(context.file) && context.unknownTaskIds.length === 0,
    },

    tasks: {
      type: "component",
      title: "4. Configure task parameters",
      build: buildTaskPanel,
      complete: () => context.taskPanel?.allConfirmed(),
    },
  };
}

// ─── MODEL ───────────────────────────────────────────────────────────────────

// The selected model supplies the rules the task methodology fields depend on.
async function loadSelectedModel(modelId, taskSection) {
  if (!modelId) {
    taskSection.setModel(null);
    return;
  }

  try {
    const model = await loadModel(modelId);

    taskSection.setModel(model);
  } catch (error) {
    console.error(error);

    // Or it would keep methodology options from the previous model.
    taskSection.setModel(null);

    renderMessage(buildFailureMessage("Loading model details failed.", error));
  }
}

// A `?model=` in the URL pre-selects that model.
async function preselectModel(state, fields, taskSection) {
  const requested = new URLSearchParams(location.search).get("model");

  if (!requested) return;

  const known = fields.model_id.options.some(
    (option) => String(option.value) === requested,
  );

  if (!known) return;

  state.model_id = requested;

  await loadSelectedModel(requested, taskSection);
}

// One request shared by the detected-task pills and the task section.
async function loadKnownTasks() {
  try {
    const { tasks } = await getMeta();

    return new Map(tasks.map((task) => [task.id, task.task_suite]));
  } catch (error) {
    console.error(error);

    renderMessage(
      buildFailureMessage(
        "Loading the task list failed — task validation is unavailable.",
        error,
      ),
    );

    return new Map();
  }
}

// ─── SUBMIT ──────────────────────────────────────────────────────────────────

// Three round-trips, each with its own progress line: only this page knows how far along
// it is.
async function submitSubmission(state, taskSection) {
  const file = state.file;
  delete state.file;

  const presigned = await presignSubmission(state, taskSection);

  renderMessage(buildInfoMessage("Uploading file…"));

  await uploadToPresignedUrl(presigned.upload_url, file);

  await createSubmission(presigned.submission_id);

  return (
    `/html/submissions/submissions.html` +
    `?id=${encodeURIComponent(presigned.submission_id)}&view=details&created`
  );
}

// ─── INITIALISATION ──────────────────────────────────────────────────────────

// `unknownTaskIds` and `taskPanel` start empty and are filled in by `setup` and the upload
// panel's `onFile`. The panels read them through the context, so they see current values.
async function loadSubmissionContext() {
  const fields = await loadSubmissionFields();

  if (!fields.model_id.options.length) {
    renderPageError("You have no models yet — a model is required to submit.");
    return null;
  }

  const knownTasks = await loadKnownTasks();
  await loadTaskFields();

  return {
    fields,
    knownTasks,
    unknownTaskIds: [],
    taskPanel: null,
    file: null,
  };
}

// Built between the form's `initialise()` and `attach()`, so a re-render can't destroy
// their listeners.
async function setupComponentPanels(form, context) {
  const { knownTasks } = context;

  context.taskPanel = createTaskSection({
    taskSuites: knownTasks,
    onChange: () => form.refresh(),
  });

  context.taskPanel.attach();

  const uploadPanel = createUploadSection({
    knownTasks,
    onFile: (file, taskIds) => {
      // A catalogue that failed to load can't judge anything, so nothing is unknown.
      context.unknownTaskIds = knownTasks.size
        ? taskIds.filter((id) => !knownTasks.has(id))
        : [];

      // Onto the context for panel 3's `complete`, and onto the state for
      // submitSubmission. Neither is a drawn field, so no redraw is owed.
      context.file = file;
      form.state.file = file;

      // Only recognised ids reach the task panel, which has no handling for the rest.
      context.taskPanel.setTasks(context.unknownTaskIds.length ? [] : taskIds);
    },
  });

  uploadPanel.attach();

  await preselectModel(form.state, context.fields, context.taskPanel);
}

loadCreatePage({
  noun: "submission",
  title: "Create a new submission",
  description: "Upload your results and configure the tasks they cover.",
  back: {
    text: "← Back to submissions",
    href: "/html/submissions/submission_list.html",
  },

  fields: (context) => context.fields,
  panels: buildPanels,
  submit: (state, context) => submitSubmission(state, context.taskPanel),

  load: loadSubmissionContext,
  setup: setupComponentPanels,
  onChange: async (key, value, cleared, { form, context }) => {
    if (key === "model_id") {
      await loadSelectedModel(form.state.model_id, context.taskPanel);
    }
  },
});
