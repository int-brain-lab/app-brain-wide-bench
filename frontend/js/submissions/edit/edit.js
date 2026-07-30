// Thin configuration of the shared detail editor (js/utils/detail-editor.js)
// for the submission card's Details tab — the counterpart of models/edit/edit.js.

import { createDetailEditor } from "../../utils/detail-editor.js";
import { updateSubmission } from "../api.js";

// Mirrors SubmissionUpdate on the server, which declares `extra="forbid"` — a key
// that isn't accepted there comes back as a 422 rather than being ignored, so
// this list and that schema have to agree.
//
// `model_id` is deliberately absent: the uploaded zip was scored against that
// model, so a submission can't be re-pointed at another one. It still renders as
// a read-only row on the Details tab, along with status, s3_key and timestamps.
const EDITABLE_KEYS = [
  "label",
  "is_public",
  "narrative_public",
  "narrative_private",
];

function submissionDetailsEdit() {
  return document.getElementById("submission-details-edit");
}

function editableKeys(fields) {
  return EDITABLE_KEYS.filter(key => key in fields);
}

// createFieldState seeds the draft from every `editable !== false` field in
// SUBMISSION_FIELDS — which includes model_id, because the create wizard needs it
// editable there. `keys` only controls what gets *rendered*, so the payload has to
// be narrowed separately or the untouched model_id would trip extra="forbid".
function buildPatch(draft, fields) {
  return Object.fromEntries(
    editableKeys(fields).map(key => [key, draft[key]])
  );
}

/**
 * @param submission the record being edited; mutated in place on save.
 * @param fields     SUBMISSION_FIELDS, with its options already loaded.
 * @param onSaved    async (submission) => void — the page re-renders itself.
 * @param onCleared  optional (labels: string) => void.
 * @param onError    optional (message: string) => void.
 */
function attachSubmissionEditor({ submission, fields, onSaved, onCleared, onError }) {
  createDetailEditor({
    container: submissionDetailsEdit,
    fields,
    keys: () => editableKeys(fields),
    record: submission,
    save: draft => updateSubmission(submission.id, buildPatch(draft, fields)),
    onSaved,
    onCleared,
    onError,
    editButton: () => document.getElementById("edit-submission"),
    saveButton: () => document.getElementById("save-submission"),
    cancelButton: () => document.getElementById("cancel-submission"),
  }).attach();
}

export { attachSubmissionEditor, submissionDetailsEdit, EDITABLE_KEYS };
