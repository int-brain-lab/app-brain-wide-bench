// Create a new submission.
//
// Contains 4 panels
//   1. Identity     submission name and associated model
//   2. File         whether the model is deterministic, the zip file, and the verdict on it
//   3. Tasks        task parameters
//   4. Visibility   submission visibility and optional narratives
//
// Panels 1 and 4 are schema-driven; panels 2 and 3 are component-driven, and their markup
// and events belong to submissionUpload.js and taskPanel.js. Panel 2 is both: the form draws
// `is_deterministic` into the slot that panel's own markup provides.
//
// Panel 3 opens on the tasks the layout check found in the chosen file, before the file is
// sent: its parameters are filled in while the transfer and the server's check run.
//
// The submission exists from the moment its file starts uploading, so its name, model and
// deterministic flag are on the server before the form is submitted. Visibility and the
// narratives are not answered until panel 4 and arrive with the tasks; the name and model
// are carried again, since they stay editable while the file is on its way.

import { getMeta } from "../api/metaApi.js";
import { loadModel } from "../api/modelApi.js";
import { finaliseSubmission } from "../api/submissionApi.js";
import { loadSubmissionFields } from "../schemas/submissionSchema.js";
import { loadTaskFields } from "../schemas/taskSubmissionSchema.js";
import { buildCreateButton } from "../components/buttons.js";
import { buildFailureMessage } from "../components/messages.js";
import { buildUploadPanel, createUploadSection } from "../widgets/submissionUpload.js";
import { buildTaskPanel, createTaskSection } from "../widgets/taskPanel.js";
import { loadCreatePage } from "../templates/createPage.js";
import { renderMessage, renderPageNote } from "../templates/pageChrome.js";

// Where a submitter with no model has to go first.
const MODEL_CREATE_HREF = "/html/models/model_create.html";

// Built from the context rather than declared as a constant: panels 2 and 3 report their
// completeness by asking objects that only exist once `setup` has run.
function buildPanels(context) {
  return {
    model: {
      type: "fields",
      title: "1. Choose a submission name and the model it belongs to",
    },

    upload: {
      type: "component",
      title: "2. Your predictions file",
      build: buildUploadPanel,

      // The two questions this panel answers separately. Panel 3 opens on the tasks read
      // out of the file, which is answered before it is sent; the form cannot be submitted
      // until the server's check of the arrived file has passed.
      unlocks: () => context.detected,
      complete: () => context.verdict === "pending",
    },

    tasks: {
      type: "component",
      title: "3. Configure task parameters",
      build: buildTaskPanel,
      complete: () => context.taskPanel?.allConfirmed(),
    },

    information: {
      type: "fields",
      title: "4. Set submission visibility and optional narratives",
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

    renderMessage(buildFailureMessage("Loading model details failed", error));
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

    renderMessage(buildFailureMessage("Loading the task list failed", error));

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

// `detected`, `hasFile`, `verdict` and the two panels start empty and are filled in by
// `setup` and the upload panel's callbacks. The panels read them through the context, so
// they see current values.
async function loadSubmissionContext() {
  // All three read /api/meta, which is memoised: one document between them.
  const [fields, knownTasks] = await Promise.all([
    loadSubmissionFields(),
    loadKnownTasks(),
    loadTaskFields(),
  ]);

  if (!fields.model_id.options.length) {
    renderPageNote("You have no models yet", {
      detail: "A submission belongs to a model, so there has to be one to submit against.",
      actions: buildCreateButton({
        href: MODEL_CREATE_HREF,
        label: "New model",
        className: "primary",
      }),
    });

    return null;
  }

  const context = {
    fields: null,
    knownTasks,
    taskPanel: null,
    uploadPanel: null,
    detected: false,
    hasFile: false,
    verdict: null,
  };

  // The schema marks `is_deterministic` uneditable, since PATCH does not accept it and
  // validation reaches its verdict under it. This is the one form that sets it, and holds it
  // still for as long as a file checked under it is held.
  //
  // `panel` is overridden too: the record's own view reads it beside the other information,
  // and here it belongs with the file whose check it decides.
  context.fields = {
    ...fields,
    is_deterministic: {
      ...fields.is_deterministic,
      panel: "upload",
      editable: true,
      lockedWhen: () => context.hasFile,
      lockedNote: "The validation check ran under this condition. Delete your file to change it.",
    },
  };

  return context;
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

    // Redrawn rather than switched off in place, so the locked field carries its note. Both
    // edges are a click elsewhere on the page, which has already committed whatever field
    // the redraw replaces.
    onFile: (held) => {
      context.hasFile = held;
      form.render();
    },

    // The layout check read them out of the file, so an unrecognised id was already refused
    // before the upload button appeared. `setTasks` refreshes the form, which is why
    // `detected` is set first.
    onTasks: (taskIds) => {
      context.detected = taskIds.length > 0;
      context.taskPanel.setTasks(taskIds);
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
