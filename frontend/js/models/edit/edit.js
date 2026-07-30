// Thin configuration of the shared detail editor (js/utils/detail-editor.js)
// for the model card: every MODEL_FIELDS key, saved via PATCH /api/models/{id}.

import { createDetailEditor } from "../../utils/detail-editor.js";
import { loadModelFields } from "../schema.js";
import { updateModel } from "../api.js";

function modelDetailsEdit() {
  return document.getElementById("model-details-edit");
}

// Async because the schema's `team_id` options are fetched. loadModelFields()
// caches, so by the time details.js gets here it resolves immediately.
async function attachButtonEvents(model, onSaved) {
  const fields = await loadModelFields();

  createDetailEditor({
    container: modelDetailsEdit,
    fields,
    // Read-only keys still render (as display rows) — same as before the
    // extraction, where the form was built from Object.keys(fields).
    keys: () => Object.keys(fields),
    record: model,
    save: draft => updateModel({ id: model.id, ...draft }),
    onSaved,
    editButton: () => document.getElementById("edit-model"),
    saveButton: () => document.getElementById("save-model"),
    cancelButton: () => document.getElementById("cancel-model"),
  }).attach();
}

export { attachButtonEvents, modelDetailsEdit };
