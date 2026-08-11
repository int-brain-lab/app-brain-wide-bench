// Create a new submission.
//
// The form is a single page with four panels. Each panel is locked until the panels above it
// are complete.
//
//   1. Model        pick a model
//   2. Information  name, visibility, narratives
//   3. Predictions  upload a zip and detect tasks
//   4. Tasks        per-task methodology
//
// The final Create button is enabled only when every panel is complete and every
// detected task is valid and confirmed.

import {
  attachFieldEvents,
  createFieldState,
  panelGroups,
  renderFields,
  renderGroups,
} from "../utils/form-fields.js";
import {
  SUBMISSION_PANELS,
  loadSubmissionFields,
} from "./submissionSchema.js";
import { loadModel } from "../models/modelApi.js";
import { apiFetch, isAuthenticated } from "../api.js";
import {
  escapeHtml,
  formatBytes,
  showError,
  showMessage
} from "../utils.js";
import {
  inferTasks,
  listZipEntries,
} from "../zip_list.js";
import { createTaskSection } from "../tasks/taskSubmissionsCreate.js";
import {
  presignSubmission,
  submitSubmission,
  uploadToPresignedUrl,
} from "./submissionApi.js";
import { showGate } from "../utils/gate.js";

// ─── PANEL CONFIGURATION ────────────────────────────────────────────────────

// Panel 4 is required but the requirement is handled by the tasks
const PANELS = [
  { panel: 1, required: ["label", "model_id"] },
  { panel: 2, required: [] },
  { panel: 3, required: ["file"] },
  { panel: 4, required: [] },
];

const PANEL_BY_NUMBER = new Map(
  PANELS.map(panel => [panel.panel, panel]),
);

// ─── STATE HELPERS ──────────────────────────────────────────────────────────

// Empty strings, null, and empty arrays are unset. false and 0 are valid values.
function isFilled(value) {
  if (value == null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;

  return true;
}

function isPanelComplete(panelNumber, state) {
  const panel = PANEL_BY_NUMBER.get(panelNumber);

  return (panel?.required ?? []).every(key => isFilled(state[key]));
}

function isPanelOpen(panelNumber, state) {
  return PANELS
    .filter(panel => panel.panel < panelNumber)
    .every(panel => isPanelComplete(panel.panel, state));
}

function hasDependentFields(fields) {
  return Object.values(fields).some(
    field => field.disabledWhen || field.disabledOptionsWhen,
  );
}

// ─── DOM ────────────────────────────────────────────────────────────────────

function getElements() {
  return {
    gate: document.getElementById("gate"),
    panels: document.getElementById("submission-panels"),
    taskPanel: document.getElementById("task-panel"),
    taskInfo: document.getElementById("task-info"),
    message: document.getElementById("form-message"),

    dropzone: document.getElementById("dropzone"),
    fileInput: document.getElementById("file-input"),
    fileInfo: document.getElementById("file-info"),
    fileName: document.getElementById("file-name"),
    fileSize: document.getElementById("file-size"),
    fileRemove: document.getElementById("file-remove"),

    createButton: document.getElementById("create-submission"),
  };
}

function getPanel(elements, panelNumber) {
  return elements.panels.querySelector(
    `[data-panel="${panelNumber}"]`,
  );
}

// ─── GENERAL UI ─────────────────────────────────────────────────────────────

// ─── PANEL RENDERING ──────────────────────────────────────────────────────────

function renderPanels(elements, state, fields) {
  for (const panel of SUBMISSION_PANELS) {
    const panelElement = getPanel(elements, panel.panel);

    if (!panelElement) continue;

    const groups = panelGroups(
      fields,
      [panel],
      {
        editableOnly: true,
        columns: 1,
      },
    );

    panelElement.innerHTML = renderGroups(
      groups,
      state,
      fields,
      renderFields,
    );
  }

  globalThis.lucide?.createIcons?.();
}


function applyLocks(elements, state) {
  for (const panel of PANELS) {
    const panelElement = getPanel(elements, panel.panel);

    if (panelElement) {
      panelElement.disabled = !isPanelOpen(panel.panel, state);
    }
  }
}

// ─── MODEL ──────────────────────────────────────────────────────────────────

// The selected model supplies team_id/model_name for the submission and the
// model-dependent rules used by the task methodology fields.
async function loadSelectedModel(
  modelId,
  state,
  taskSection,
  elements,
) {
  if (!modelId) {
    state.team_id = null;
    state.model_name = null;
    taskSection.setModel(null);
    return;
  }

  showMessage(elements.message, "Loading…");

  try {
    const model = await loadModel(modelId);

    state.team_id = model.team_id;
    state.model_name = model.name;

    taskSection.setModel(model);
    showMessage(elements.message, "");
  } catch (error) {
    console.error(error);

    state.team_id = null;
    state.model_name = null;

    // Clear the task section's model too. Otherwise, it could retain
    // methodology options from a previously selected model.
    taskSection.setModel(null);

    showError(elements.message, "Could not load model details.");
  }
}

// ─── PRESELECTION ───────────────────────────────────────────────────────────

// `?model=<id>` lets a caller arrive with the model already chosen. The model dashboard's
// create strip and the post-create card on model_details.html both pass it, so "for this
// model" is honoured rather than being a promise this form breaks.
//
// Validated against the picker's own options first: an id that isn't one of the caller's
// models would select nothing, leaving the dropdown blank while `state.model_id` claimed a
// value — and panel 2 would unlock against a model the server would refuse.
async function preselectModel(state, fields, taskSection, elements) {
  const requested = new URLSearchParams(location.search).get("model");

  if (!requested) return;

  const known = fields.model_id.options.some(
    option => String(option.value) === requested,
  );

  if (!known) return;

  state.model_id = requested;

  // The same call the change handler makes, so team_id, model_name and the task panel's
  // model-dependent options all end up as they would had the user picked it by hand.
  await loadSelectedModel(requested, state, taskSection, elements);
}

// ─── DETECTED TASKS ─────────────────────────────────────────────────────────

// One request is shared by the detected-task pills and the task section.
async function loadKnownTasks(elements) {
  try {
    const knownTasks = await apiFetch("/api/tasks/");

    return new Map(
      knownTasks.map(task => [task.id, task.task_suite]),
    );
  } catch (error) {
    console.error(error);

    showError(
      elements.message,
      "Could not load the list of known tasks — task validation is unavailable.",
    );

    return new Map();
  }
}

function isKnownTask(taskId, knownTasks) {
  return knownTasks.size === 0 || knownTasks.has(taskId);
}

function renderDetectedTasks(elements, taskIds, knownTasks) {
  const pills = taskIds
    .map(taskId => {
      const status = isKnownTask(taskId, knownTasks)
        ? "success"
        : "error";

      return `
        <span class="badge ${status}">
          ${escapeHtml(taskId)}
        </span>
      `;
    })
    .join("");

  elements.taskInfo.hidden = false;
  elements.taskInfo.className = "card";

  elements.taskInfo.innerHTML = `
    <div class="column gap-md">
      <div class="info-msg">
        Detected ${taskIds.length}
        task${taskIds.length === 1 ? "" : "s"} in this file
      </div>

      <div class="row left gap-sm">
        ${pills}
      </div>
    </div>
  `;
}

// ─── FILE UPLOAD ────────────────────────────────────────────────────────────

function isValidZip(file) {
  return Boolean(
    file && file.name.toLowerCase().endsWith(".zip"),
  );
}

function showSelectedFile(elements, file) {
  elements.dropzone.hidden = true;
  elements.fileInfo.hidden = false;

  elements.fileName.textContent = file.name;
  elements.fileSize.textContent = formatBytes(file.size);
}

function showDropzone(elements) {
  // Reset the native input as well, otherwise selecting the same file again
  // would not fire a change event.
  elements.fileInput.value = "";

  elements.dropzone.hidden = false;
  elements.fileInfo.hidden = true;
  elements.taskInfo.hidden = true;
}

async function processSelectedFile(
  file,
  state,
  knowTasks,
  taskSection,
  elements,
) {
  if (!isValidZip(file)) {
    showError(elements.message, "That isn't a .zip file.");
    return;
  }

  showMessage(elements.message, "");

  state.file = file;
  showSelectedFile(elements, file);

  let taskIds = [];

  try {
    const paths = await listZipEntries(file);

    taskIds = inferTasks(paths);
    renderDetectedTasks(elements, taskIds, knowTasks);
  } catch (error) {
    console.error(error);

    showError(
      elements.message,
      `Could not read the zip (${error.message}). Check the file and upload it again.`,
    );
  }

  // The task section owns its own rendering and notifies the page through
  // onChange, which updates panel locks and the submit button.
  taskSection.applyDetected(taskIds);
}

function removeSelectedFile(state, taskSection, elements) {
  state.file = null;

  showDropzone(elements);

  // Tasks are derived entirely from the uploaded file, so removing the file
  // also removes the detected tasks.
  taskSection.applyDetected([]);
}

function attachDropzoneVisuals(elements) {
  const { dropzone, fileInput } = elements;

  dropzone.addEventListener("click", () => {
    fileInput.click();
  });

  for (const eventName of ["dragenter", "dragover"]) {
    dropzone.addEventListener(eventName, event => {
      event.preventDefault();
      dropzone.classList.add("active");
    });
  }

  for (const eventName of ["dragleave", "dragend", "drop"]) {
    dropzone.addEventListener(eventName, () => {
      dropzone.classList.remove("active");
    });
  }
}

function attachFileEvents(
  state,
  knowTasks,
  taskSection,
  elements,
) {
  const { fileInput, dropzone, fileRemove } = elements;

  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];

    if (file) {
      processSelectedFile(
        file,
        state,
        knowTasks,
        taskSection,
        elements,
      );
    }
  });

  dropzone.addEventListener("drop", event => {
    event.preventDefault();

    const file = event.dataTransfer.files[0];

    if (file) {
      processSelectedFile(
        file,
        state,
        knowTasks,
        taskSection,
        elements,
      );
    }
  });

  fileRemove.addEventListener("click", () => {
    removeSelectedFile(state, taskSection, elements);
  });

  attachDropzoneVisuals(elements);
}

// ─── SUBMIT ─────────────────────────────────────────────────────────────

function canSubmit(state, taskSection) {
  const panelsComplete = PANELS.every(panel =>
    isPanelComplete(panel.panel, state),
  );

  return (
    panelsComplete &&
    taskSection.allValid() &&
    taskSection.allConfirmed()
  );
}

function updateSubmitButton(elements, state, taskSection) {
  elements.createButton.disabled = !canSubmit(state, taskSection);
}

function refresh(elements, state, taskSection) {
  applyLocks(elements, state);
  updateSubmitButton(elements, state, taskSection);
}


// ─── FIELD CHANGES ──────────────────────────────────────────────────────────

function handleFieldChange(
  state,
  fields,
  cleared,
  taskSection,
  elements,
) {
  if (cleared.length) {
    const labels = cleared
      .map(key => fields[key].label)
      .join(", ");

    showError(
      elements.message,
      `Cleared (no longer valid): ${labels}`,
    );
  }

  if (
    cleared.length ||
    hasDependentFields(fields)
  ) {
    renderPanels(elements, state, fields);
  }

  refresh(elements, state, taskSection);
}

// ─── SUBMISSION ─────────────────────────────────────────────────────────────

async function handleSubmit(
  state,
  taskSection,
  elements,
) {
  elements.createButton.disabled = true;

  try {
    showMessage(elements.message, "Requesting upload URL…");

    const presigned = await presignSubmission(
      state, taskSection,
    );

    showMessage(elements.message, "Uploading file…");

    await uploadToPresignedUrl(
      presigned.upload_url,
      state.file,
    );

    showMessage(elements.message, "Finalising submission…");

    await submitSubmission(presigned.submission_id);

    showMessage(
      elements.message,
      "Submitted. Redirecting to your dashboard…",
    );

    window.location.href =
      `/html/submissions/submission_details.html?id=${encodeURIComponent(presigned.submission_id)}`;
  } catch (error) {
    console.error(error);

    showError(
      elements.message,
      `Submission failed: ${error.message}`,
    );

    // Re-check rather than blindly re-enabling. The state may have changed
    // while the asynchronous upload was in progress.
    updateSubmitButton(elements, state, taskSection);
  }
}

// ─── INITIALISATION ─────────────────────────────────────────────────────────

async function loadSubmissionCreatePage() {
  const elements = getElements();

  try {
    if (!(await isAuthenticated())) {
      showGate(elements, false);
      return;
    }

    showGate(elements, true);

    const fields = await loadSubmissionFields();

    if (!fields.model_id.options.length) {
      showError(
        elements.message,
        "You have no models yet — a model is required to submit.",
      );
      return;
    }

    const state = createFieldState(fields);
    const knownTasks = await loadKnownTasks(elements);

    const taskSection = createTaskSection({
      container: elements.taskPanel,

      onChange: () => refresh(elements, state, taskSection),
    });

    await taskSection.initialise(knownTasks);

    // Before the first render, so the dropdown shows the choice and panel 2 is already
    // unlocked rather than opening a moment later.
    await preselectModel(state, fields, taskSection, elements);

    renderPanels(elements, state, fields);
    refresh(elements, state, taskSection);

    // Bind to the panel fieldsets rather than the whole container. The task
    // panel uses a different schema and is managed by taskSection.
    for (const panel of SUBMISSION_PANELS) {
      const panelElement = getPanel(elements, panel.panel);

      if (!panelElement) continue;

      attachFieldEvents(
        panelElement,
        state,
        fields,
        async (key, value, cleared) => {
          if (key === "model_id") {
            await loadSelectedModel(
              state.model_id,
              state,
              taskSection,
              elements,
            );
          }

          handleFieldChange(
            state,
            fields,
            cleared,
            taskSection,
            elements,
          );
        },
      );
    }

    attachFileEvents(
      state,
      knownTasks,
      taskSection,
      elements,
    );

    elements.createButton.addEventListener(
      "click",
      () => handleSubmit(
        state,
        taskSection,
        elements,
      ),
    );
  } catch (error) {
    console.error(
      "Failed to initialise create page:",
      error,
    );

    showError(
      elements.message,
      "Could not load the submission form.",
    );
  }
}

loadSubmissionCreatePage();
