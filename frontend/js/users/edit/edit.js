// Thin configuration of the shared detail editor (js/utils/detail-editor.js) for
// the settings page — the counterpart of models/edit/edit.js.

import { createDetailEditor } from "../../utils/detail-editor.js";
import { USER_FIELDS } from "../schema.js";
import { updateMe } from "../api.js";

function userDetailsEdit() {
  return document.getElementById("user-details-edit");
}

/**
 * @param user     the record being edited; mutated in place on save.
 * @param onSaved  async (user) => void — re-render the read-only view.
 * @param onError  (message: string) => void.
 */
function attachUserEditor({ user, onSaved, onError }) {
  createDetailEditor({
    container: userDetailsEdit,
    fields: USER_FIELDS,

    // Every key, so the form shows email / provider / ORCID as read-only context
    // alongside the two editable inputs. `editable: false` in USER_FIELDS is what
    // decides which is which, and createFieldState keeps them out of the draft —
    // so only name and affiliation are ever sent, matching UserUpdate.
    keys: () => Object.keys(USER_FIELDS),
    record: user,
    save: draft => updateMe(draft),
    onSaved,
    onError,
    editButton: () => document.getElementById("edit-user"),
    saveButton: () => document.getElementById("save-user"),
    cancelButton: () => document.getElementById("cancel-user"),
  }).attach();
}

export { attachUserEditor, userDetailsEdit };
