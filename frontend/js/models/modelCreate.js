// Create a new model.
//
// The form is a single page with three panels. Panel 1 requires a name and team;
// panels 2 and 3 contain optional fields. Panels are locked until all preceding
// panels are complete.
//
//   1. Details      name, team
//   2. Links        optional links
//   3. Parameters   optional model parameters
//
// The final Create button is enabled only when every required panel is complete.

import {
  attachFieldEvents,
  createFieldState,
  panelGroups,
  renderFields,
  renderGroups,
} from "../utils/form-fields.js";
import {
  MODEL_PANELS,
  loadModelFields,
} from "./modelSchema.js";
import { createModel } from "./modelApi.js";
import { isAuthenticated } from "../api.js";
import {showError, showMessage} from "../utils.js";
import { showGate } from "../utils/gate.js";

// ─── PANEL CONFIGURATION ────────────────────────────────────────────────────

const PANELS = [
  { panel: 1, required: ["name", "team_id"] },
  { panel: 2, required: [] },
  { panel: 3, required: [] },
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

// A panel opens only when every preceding panel is complete. This means that
// clearing a value in an earlier panel also closes all panels below it.
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
    panels: document.getElementById("model-panels"),
    message: document.getElementById("form-message"),
    createButton: document.getElementById("create-model"),
    createCard: document.getElementById("create-submission")
  };
}

function getPanel(elements, panelNumber) {
  return elements.panels.querySelector(
    `[data-panel="${panelNumber}"]`,
  );
}

// ─── GENERAL UI ─────────────────────────────────────────────────────────────

// ─── PANEL RENDERING ────────────────────────────────────────────────────────

function buildPanel(panel, state, fields) {
  const groups = panelGroups(
    fields,
    [panel],
    {
      editableOnly: true,
      columns: 1,
    },
  );

  if (groups.length === 0) {
    return "";
  }

  return `
    <fieldset
      class="form-panel"
      data-panel="${panel.panel}"
    >
      ${renderGroups(
        groups,
        state,
        fields,
        renderFields,
      )}
    </fieldset>
  `;
}

function renderPanels(elements, state, fields) {
  elements.panels.innerHTML = MODEL_PANELS
    .map(panel => buildPanel(panel, state, fields))
    .join("");

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

// ─── SUBMIT ─────────────────────────────────────────────────────────────────

function canSubmit(state) {
  return isPanelComplete(1, state);
}

function updateSubmitButton(elements, state) {
  elements.createButton.disabled = !canSubmit(state);
}

function refresh(elements, state) {
  applyLocks(elements, state);
  updateSubmitButton(elements, state);
}

// ─── FIELD CHANGES ───────────────────────────────────────────────────────────

function handleFieldChange(
  elements,
  state,
  fields,
  cleared,
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

  refresh(elements, state);
}

// ─── SUBMISSION ─────────────────────────────────────────────────────────────

async function handleSubmit(elements, state) {
  showMessage(elements.message, "")
  elements.createButton.disabled = true;

  try {
    const model = await createModel(state);

    window.location.href =
      `/html/models/models.html?id=${encodeURIComponent(model.id)}&view=details&created`;

  } catch (error) {
    console.error(error);

    showError(
      elements.message,
      `Failed to create model: ${error.message}`,
    );

    // Re-check the current state rather than blindly enabling the button.
    refresh(elements, state);
  }
}

// ─── INITIALISATION ─────────────────────────────────────────────────────────

async function loadModelCreatePage() {
  const elements = getElements();

  try {
    if (!(await isAuthenticated())) {
      showGate(elements, false);
      return;
    }

    showGate(elements, true);

    const fields = await loadModelFields();
    const state = createFieldState(fields);

    renderPanels(elements, state, fields);
    refresh(elements, state);

    // The container survives panel re-renders, so event delegation can be
    // attached once here.
    attachFieldEvents(
      elements.panels,
      state,
      fields,
      (key, value, cleared) => {
        handleFieldChange(
          elements,
          state,
          fields,
          cleared,
        );
      },
    );

    elements.createButton.addEventListener(
      "click",
      () => handleSubmit(elements, state),
    );
  } catch (error) {
    console.error(
      "Failed to initialise create page:",
      error,
    );

    showError(
      elements.message,
      "Could not load this page.",
    );
  }
}

loadModelCreatePage();

