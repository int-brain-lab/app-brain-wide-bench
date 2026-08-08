import { createWizard } from "../wizard.js";
import {
  attachFieldEvents,
  createFieldState,
} from "../utils/form-fields.js";

import { loadSubmissionFields } from "./submissionSchema.js";

import {
  attachDropzoneVisuals,
  clearModelPreview,
  formElement,
  formPanels,
  onFileDropped,
  onFileRemoved,
  onFileSelected,
  onSubmit,
  renderForm,
  renderModelPreview,
  renderSummary,
  setSubmitEnabled,
  showDropzone,
  showGate,
  showMessage,
  showSelectedFile,
  finalCheckbox, onConfirmed
} from "./submissionCreateView.js";

import {applyDetectedTasks, getTaskIds, getTaskPayloads, initialiseTasks, isTasksConfirmed, isTasksValid, setSelectedModel} from "../tasks/tasks.js";
import {loadModel} from "../models/modelApi.js";
import {formatBytes} from "../utils.js";
import {presignSubmission, submitSubmission, uploadToPresignedUrl} from "./submissionApi.js";
import {isAuthenticated} from "../api.js";
import {inferTasks, listZipEntries} from "../zip_list.js";


// ─── WIZARD ────────────────────────────────────────────────
const WIZARD_STEPS = [
  "Select model",
  "Submission details",
  "Upload predictions",
  "Review tasks",
  "Submit",
];


function canAdvance(step, state) {
  switch (step) {
    case 1:
      return state.model_id != null;

    case 2:
      return state.label.trim() !== "";

    case 3:
      return state.file != null;

    case 4:
      return (
        isTasksValid() &&
        isTasksConfirmed()
      );

    case 5:
      return (
        isTasksValid() &&
        isTasksConfirmed() &&
        finalCheckbox()
      );

    default:
      return true;
  }
}

function onStepChange(state) {
  return step => {
    if (step === WIZARD_STEPS.length) renderSummary(buildSummaryRows(state));
  };
}

function initialiseWizard(state) {
  const wizard = createWizard({
    root: formElement(),
    steps: WIZARD_STEPS,
    onStepChange: onStepChange(state),
    canAdvance: step => canAdvance(step, state),
  });

  wizard.initialise();
  return wizard;
}


// ─── PANEL 1 - MODEL SELECTION ────────────────────────────────────────────────
// `team_id` and `model_name` are both `editable: false` in SUBMISSION_FIELDS, so
// createFieldState leaves them out of `state` entirely — they're derived from the
// chosen model and set here. model_name exists purely for the review summary;
// forgetting it is why that step used to read "Model: —".
async function loadSelectedModel(modelId, state) {
  if (!modelId) {
    state.team_id = null;
    state.model_name = null;
    clearModelPreview();
    setSelectedModel(null);
    return;
  }

  showMessage("Loading...");

  try {
    const model = await loadModel(modelId);
    state.team_id = model.team_id;
    state.model_name = model.name;
    renderModelPreview(model);
    showMessage("")
    setSelectedModel(model);
  } catch (err) {
    console.error(err);
    state.team_id = null;
    state.model_name = null;
    showMessage("Could not load model details.");
    setSelectedModel(null);
  }
}


// ─── PANEL 3 - FILE SELECTION ────────────────────────────────────────────────
function removeSelectedFile(state) {
  state.file = null;
  showDropzone();
}

function isValidZip(file) {
  return Boolean(file && file.name.toLowerCase().endsWith(".zip"));
}

async function processSubmissionArchive(file, state) {
  if (!isValidZip(file)) {
    return;
  }

  state.file = file;
  showSelectedFile(file);

  let detectedTaskIds = [];
  let error = null;

  try {
    const paths = await listZipEntries(file);
    detectedTaskIds = inferTasks(paths);
  } catch (err) {
    console.error(err);
    error = `Could not read the zip (${err.message}). You can add tasks manually in the next step.`;
  }

  applyDetectedTasks(detectedTaskIds, error);
}

function initialiseUpload(state, wizard) {
  onFileSelected(file => processSubmissionArchive(file, state));
  onFileDropped(file => processSubmissionArchive(file, state));
  onFileRemoved(() => {
    removeSelectedFile(state);
    wizard.updateNavigation();
  });
  attachDropzoneVisuals();
}


// ─── FORM FIELD ────────────────────────────────────────────────
// `cleared` now arrives from attachFieldEvents, which revalidates as part of
// applying the change — this handler no longer revalidates a second time.
function createFieldChangeHandler(state, fields) {
  return async (key, value, cleared) => {
    if (key === "model_id") {
      // Awaited so the nav update in attachFormEvents reflects the resolved
      // model, not a mid-flight one — otherwise a fast click could reach later
      // steps before the model (and its is_pretrained/modalities) actually
      // load. Runs first so its own showMessage("") can't wipe the notice below.
      await loadSelectedModel(state.model_id, state);
    }

    if (cleared.length) {
      const labels = cleared.map(clearedKey => fields[clearedKey].label).join(", ");
      showMessage(`Cleared (no longer valid): ${labels}`);
    }

    renderForm(state, fields);
  };
}

// Scoped to the SUBMISSION_FIELDS panels specifically, not the whole
// formElement() — #task-list also lives inside the wizard form but renders a
// different schema (TASK_FIELDS), so binding here instead of the whole form
// keeps that entirely out of reach rather than relying on a defensive check.
function attachFormEvents(state, fields, wizard) {
  const handleFieldChange = createFieldChangeHandler(state, fields);
  const onChange = async (key, value, cleared) => {
    await handleFieldChange(key, value, cleared);
    wizard.updateNavigation();
  };

  formPanels().forEach(panel => attachFieldEvents(panel, state, fields, onChange));
}


// ─── SUBMIT ────────────────────────────────────────────────────
function buildSummaryRows(state) {
  const modelName = state.model_name ?? "—";
  const submissionName = state.label.trim() || "—";
  const publish = state.is_public ? "Yes" : "No";
  const file = state.file
    ? `${state.file.name} (${formatBytes(state.file.size)})`
    : "—";
  const taskCount = getTaskIds().length;

  return [
    ["Model", modelName],
    ["Submission name", submissionName],
    ["Publish on leaderboard", publish],
    ["File", file],
    ["Tasks", `${taskCount} task${taskCount === 1 ? "" : "s"}`],
  ];
}

// canAdvance only checks the *current* step's own condition (see wizard.js),
// so e.g. clearing the file while sitting on step 5 doesn't re-disable Submit —
// this is the safety net that catches that.
function validateSubmission(state) {
  if (!state.model_id) {
    // #form-message sits outside every step panel (always visible), so this
    // is seen regardless of which step the user's on — but since the model
    // picker itself only exists on step 1, name the step explicitly.
    showMessage("Select a model (step 1).");
    return null;
  }

  const label = state.label.trim();
  if (!label) {
    showMessage("Enter a submission name.");
    return null;
  }

  if (!state.file) {
    showMessage("Choose a .zip file.");
    return null;
  }

  // Each entry is {task_id, ...methodology} — the per-task methodology collected
  // in the carousel is persisted at presign, not discarded as it used to be.
  const tasks = getTaskPayloads();
  if (!tasks.length) {
    showMessage("Add at least one task.");
    return null;
  }

  return {
    teamId: state.team_id,
    modelId: state.model_id,
    label,
    tasks,
    isPublic: state.is_public,
    file: state.file,
  };
}

async function handleSubmit(state, wizard) {
  const submission = validateSubmission(state);

  if (!submission) {
    return;
  }

  setSubmitEnabled(false);

  try {
    showMessage("Requesting upload URL…");

    const presign = await presignSubmission({
      team_id: submission.teamId,
      model_id: submission.modelId,
      label: submission.label,
      tasks: submission.tasks,
      is_public: submission.isPublic,
    });

    showMessage("Uploading file…");
    await uploadToPresignedUrl(presign.upload_url, submission.file);

    showMessage("Finalising submission…");
    await submitSubmission(presign.submission_id);

    showMessage("Submitted! Redirecting to your dashboard…");
    window.location.href = "/html/dashboard/dashboard.html";

  } catch (error) {
    console.error(error);
    showMessage(`Submission failed: ${error.message}`);
    wizard.updateNavigation();
  }
}


function attachCheckbox(wizard) {
  onConfirmed(() => {
    wizard.updateNavigation();
  });
}


async function initialise() {
  try {
    if (!(await isAuthenticated())) {
      showGate(false);
      return;
    }

    showGate(true);

    const fields = await loadSubmissionFields();

    if (!fields.model_id.options.length) {
      showMessage("You have no models yet — a model is required to submit.");
      return;
    }

    const state = createFieldState(fields);

    renderForm(state, fields);

    const wizard = initialiseWizard(state);

    attachFormEvents(state, fields, wizard);
    initialiseUpload(state, wizard);
    await initialiseTasks(wizard);

    attachCheckbox(wizard);

    onSubmit(() => handleSubmit(state, wizard));

  } catch (err) {
    console.error("Failed to initialise create page:", err);
    showMessage("Could not load the submission form.");
  }
}

initialise();
