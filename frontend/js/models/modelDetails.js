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
import {
  panelGroups,
  renderDisplayFields,
  renderGroups,
} from "../utils/form-fields.js";


// ─── DOM ────────────────────────────────────────────────────────────────────

function getElements() {
  return {
    message: document.getElementById("form-message"),
    title: document.getElementById("model-title"),
    description: document.getElementById("model-description"),
    backLink: document.getElementById("back-to-model"),
    details: document.getElementById("model-details"),
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

// ─── INITIALISATION ─────────────────────────────────────────────────────────

async function loadModelDetailsPage() {
  const elements = getElements();
  try {
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
