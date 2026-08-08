import { createDetailEditor } from "../utils/detail-editor.js";
import {loadModelFields, MODEL_PANELS} from "./modelSchema.js";
import {loadModel, updateModel} from "./modelApi.js";
import {formatDate} from "../utils.js";
import {panelGroups, renderDisplayFields, renderGroups} from "../utils/form-fields.js";


// ─── RENDERING ──────────────────────────────────────────────────────────────

function renderHeader(model) {
  document.getElementById("model-title").textContent = model.name;
  document.getElementById("model-description").textContent =
    `${model.team_name} · Created ${formatDate(model.created_at)}`;
}

function renderBackLink(model) {
  const link = document.getElementById("back-to-model");

  link.textContent = `← Back to ${model.name}`;
  link.href = `/html/models/model_dashboard.html?id=${encodeURIComponent(model.id)}`;
}

function renderDetails(model, fields) {
  document.getElementById("model-details").innerHTML =
    renderGroups(panelGroups(fields, MODEL_PANELS), model, fields, renderDisplayFields);
}


// ─── EVENTS ─────────────────────────────────────────────────────────────────

function attachEditor(model, fields) {

  createDetailEditor({
    container: document.getElementById("model-details"),
    editButton: document.getElementById("edit-model"),
    saveButton: document.getElementById("save-model"),
    cancelButton: document.getElementById("cancel-model"),
    record: model,
    fields,
    groups: () => panelGroups(fields, MODEL_PANELS, { columns: 1 }),
    save: draft => updateModel({ id: model.id, ...draft }),
    onSaved: () => renderDetails(model, fields),
    onCancel: () => renderDetails(model, fields),
  }).attach();
}


async function loadModelDetailsPage() {
      const modelId = new URLSearchParams(location.search).get("id");
      const model = await loadModel(modelId);
      const fields = await loadModelFields();

      renderHeader(model);
      renderBackLink(model);
      renderDetails(model, fields);
      attachEditor(model, fields);

      globalThis.lucide?.createIcons?.();
}

loadModelDetailsPage()