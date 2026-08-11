// Model details
//
// A page showing the details for a single model.
//
// The page contains an edit button that allows the user to update editable fields.
// The fields and title of each panel in the page is defined in MODEL_PANELS.
// Editable fields are defined in the MODEL_FIELDS.

import { Editor } from "../utils/editor.js";
import {
  loadModelFields,
  MODEL_PANELS,
} from "./modelSchema.js";
import {
  loadModel,
  updateModel,
} from "./modelApi.js";
import {formatDate, showError} from "../utils.js";
import { appendCreateCard } from "../utils/create-card.js";
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
    message: document.getElementById("form-message"),
    title: document.getElementById("model-title"),
    description: document.getElementById("model-description"),
    backLink: document.getElementById("back-to-model"),
    details: document.getElementById("model-details"),
    postCreate: document.getElementById("model-post-create"),
    editButton: document.getElementById("edit-model"),
    saveButton: document.getElementById("save-model"),
    cancelButton: document.getElementById("cancel-model"),
  };
}

// ─── RENDERING ──────────────────────────────────────────────────────────────

function renderHeader(elements, model) {
  elements.title.textContent = model.name;

  elements.description.textContent = [
    model.team_name,
    model.created_at
      ? `Created ${formatDate(model.created_at)}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function renderBackLink(elements, model) {
  elements.backLink.textContent = `← Back to ${model.name}`;
  elements.backLink.href =
    `/html/models/model_dashboard.html?id=${encodeURIComponent(model.id)}`;
}

function renderDetails(elements, model, fields) {
  const groups = panelGroups(fields, MODEL_PANELS);

  elements.details.innerHTML =
    renderGroups(
      groups,
      model,
      fields,
      renderDisplayFields,
    );
}

// ─── EDITOR ─────────────────────────────────────────────────────────────────

function attachEditor(elements, model, fields) {
  Editor({
    container: elements.details,
    editButton: elements.editButton,
    saveButton: elements.saveButton,
    cancelButton: elements.cancelButton,
    record: model,
    fields: fields,
    groups: () => panelGroups(fields, MODEL_PANELS, { columns: 1 }),
    save: draft => updateModel({id: model.id, ...draft}),
    onSaved: saved => renderDetails(elements, saved, fields),
    onCancel: () => renderDetails(elements, model, fields),
  })
    .attach();

}

// Shown only when model_create.html sent us here, which it signals with `&created`. A
// freshly registered model has nothing submitted against it yet, and this is the one moment
// we know that for certain without asking — so the page points at the next step rather than
// being a dead end.
//
// Absent on every other visit: the model dashboard is where an existing model's submissions
// live, and repeating the prompt there would be noise.
function renderPostCreate(elements, model) {
  if (!new URLSearchParams(location.search).has("created")) return;

  appendCreateCard(elements.postCreate, {
    // `?model=` so the form arrives with this model already chosen — otherwise the label
    // promises something the create page wouldn't honour.
    href: `/html/submissions/submission_create.html?model=${encodeURIComponent(model.id)}`,
    label: "Make your first submission for this model",
  });
}

// The dashboard's Edit button links here with `&edit` so it lands in edit mode rather than
// on the read-only card. Clicking the button rather than calling the editor's startEditing
// directly keeps one path into edit mode, which anything hanging off onEdit relies on.
function openEditIfRequested(elements) {
  if (new URLSearchParams(location.search).has("edit")) {
    elements.editButton.click();
  }
}

// ─── INITIALISATION ─────────────────────────────────────────────────────────

async function loadModelDetailsPage() {
  const elements = getElements();
  try {
    if (!(await isAuthenticated())) {
      showGate(elements, false);
      return;
    }

    showGate(elements, true);

    const modelId = new URLSearchParams(location.search).get("id");

    if (!modelId) {
      showError(
        elements.message,
        "No model id in the URL.",
      );
      return;
    }

    const [model, fields] = await Promise.all([
      loadModel(modelId),
      loadModelFields(),
    ]);

    if (!model) {
      showError(
        elements.message,
        `Could not load model ${modelId}.`,
      );
      return;
    }

    renderHeader(elements, model);
    renderBackLink(elements, model);
    renderDetails(elements, model, fields);
    attachEditor(elements, model, fields);
    openEditIfRequested(elements);
    renderPostCreate(elements, model);

    globalThis.lucide?.createIcons?.();
  } catch (error) {
    console.error(
      "Failed to load model details:",
      error,
    );

    showError(
      elements.message,
      "Model details page could not be loaded.",
    );
  }
}

loadModelDetailsPage();
