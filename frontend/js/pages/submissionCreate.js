// Create a new submission.
//
// Contains 4 panels
//   1. Identity     submission name and associated model
//   2. Visibility   submission visibility and optional narratives
//   3. File         upload a zip file, and the server's verdict on it
//   4. Tasks        task parameters
//
// Panels 1 and 2 are schema-driven, panels 3 and 4 are component-driven and their markup
// and events are built and controlled via submissionUpload.js and taskPanel.js.
//
// The submission exists from the moment its file starts uploading, so panels 1 and 2 have
// already been sent by the time the form is submitted. Submitting carries them again along
// with the tasks, since they stay editable while the file is on its way.

import { getMeta } from "../api/metaApi.js";
import { loadModel } from "../api/modelApi.js";
import { finaliseSubmission } from "../api/submissionApi.js";
import { loadSubmissionFields } from "../schemas/submissionSchema.js";
import { loadTaskFields } from "../schemas/taskSubmissionSchema.js";
import { buildFailureMessage } from "../components/messages.js";
import { buildUploadPanel, createUploadSection } from "../widgets/submissionUpload.js";
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

      // The two questions this panel answers separately. Panel 4 opens as soon as the file
      // has arrived, so its metadata is filled in while the server checks the file; the
      // form cannot be submitted until that check has passed.
      unlocks: () => context.uploaded,
      complete: () => context.verdict === "pending",
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

  const known = fields.model_id.options.some((option) => String(option.value) === requested);

  if (!known) return;

  state.model_id = requested;

  await loadSelectedModel(requested, taskSection);
}

// The suites the task section groups its tasks by. The task *list* comes from
// prevalidation, which reads the file itself.
async function loadKnownTasks() {
  try {
    const { tasks } = await getMeta();

    return new Map(tasks.map((task) => [task.id, task.task_suite]));
  } catch (error) {
    console.error(error);

    renderMessage(buildFailureMessage("Loading the task list failed.", error));

    return new Map();
  }
}

// ─── SUBMIT ──────────────────────────────────────────────────────────────────

// One round trip: the submission and its file are already on the server, and this is the
// tasks plus whatever panels 1-2 now say.
async function submitSubmission(state, context) {
  const submissionId = context.uploadPanel.submissionId();

  await finaliseSubmission(submissionId, state, context.taskPanel);

  return (
    `/html/submissions/submissions.html` +
    `?id=${encodeURIComponent(submissionId)}&view=details&created`
  );
}

// ─── INITIALISATION ──────────────────────────────────────────────────────────

// `uploaded`, `verdict` and the two panels start empty and are filled in by `setup` and the
// upload panel's callbacks. The panels read them through the context, so they see current
// values.
async function loadSubmissionContext() {
  // All three read /api/meta, which is memoised: one document between them.
  const [fields, knownTasks] = await Promise.all([
    loadSubmissionFields(),
    loadKnownTasks(),
    loadTaskFields(),
  ]);

  if (!fields.model_id.options.length) {
    renderPageError("You have no models yet — a model is required to submit.");
    return null;
  }

  return {
    // The schema marks `is_deterministic` uneditable, since PATCH does not accept it and
    // validation reaches its verdict under it. This is the one form that sets it.
    fields: {
      ...fields,
      is_deterministic: { ...fields.is_deterministic, editable: true },
    },

    knownTasks,
    taskPanel: null,
    uploadPanel: null,
    uploaded: false,
    verdict: null,
  };
}

// Built between the form's `initialise()` and `attach()`, so a re-render can't destroy
// their listeners.
async function setupComponentPanels(form, context) {
  context.taskPanel = createTaskSection({
    taskSuites: context.knownTasks,
    onChange: () => form.refresh(),
  });

  context.taskPanel.attach();

  context.uploadPanel = createUploadSection({
    state: form.state,

    // Prevalidation read them out of the file, so an unrecognised id was already refused
    // before the upload started.
    onTasks: (taskIds) => context.taskPanel.setTasks(taskIds),

    onUploaded: (uploaded) => {
      context.uploaded = uploaded;
      form.refresh();
    },

    onVerdict: (verdict) => {
      context.verdict = verdict;
      form.refresh();
    },
  });

  context.uploadPanel.attach();

  await preselectModel(form.state, context.fields, context.taskPanel);
}

loadCreatePage({
  noun: "submission",
  title: "Create a new submission",
  description: "Upload your results and configure the tasks they cover.",
  cancelHref: "/html/submissions/submission_list.html",

  fields: (context) => context.fields,
  panels: buildPanels,
  submit: submitSubmission,

  load: loadSubmissionContext,
  setup: setupComponentPanels,
  onChange: async (key, value, cleared, { form, context }) => {
    if (key === "model_id") {
      await loadSelectedModel(form.state.model_id, context.taskPanel);
    }
  },
});
