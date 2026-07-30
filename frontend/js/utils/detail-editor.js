// Generic "view a record / click Edit / change fields / Save or Cancel" flow for
// a details page. Extracted from the model card so the submission card can use
// the same lifecycle; the pages differ only in their schema, their save call,
// and which DOM ids they use.
//
// Assumes the tab convention in js/tab.js: a read-only `section[data-tab]` and a
// hidden edit `section[data-tab]` alongside it.

import { showTab } from "../tab.js";
import {
  createFieldState,
  getFieldValue,
  renderFields,
  setFieldValue,
} from "./form-fields.js";

/**
 * @param container    () => Element — where the edit form is rendered.
 * @param fields       the schema (MODEL_FIELDS, SUBMISSION_FIELDS, ...).
 * @param keys         () => string[] — which keys the form shows. A thunk, not an
 *                     array, because `fields` can gain options asynchronously.
 * @param record       the record being edited. Mutated in place on a successful
 *                     save so the surrounding page sees the new values.
 * @param save         async (draft) => updated record (or null/undefined on failure).
 * @param onSaved      optional async (record) => void, after a successful save —
 *                     e.g. re-render the page's tabs.
 * @param onCleared    optional (labels: string) => void, when a change
 *                     invalidated other fields.
 * @param onError      optional (message: string) => void.
 * @param editButton / saveButton / cancelButton  () => Element|null.
 * @param viewTab / editTab  data-tab values to switch between.
 */
function createDetailEditor({
  container,
  fields,
  keys,
  record,
  save,
  onSaved,
  onCleared,
  onError,
  editButton,
  saveButton,
  cancelButton,
  viewTab = "details",
  editTab = "details-edit",
}) {
  // Edits accumulate on a draft, never on `record` — so Cancel is free and a
  // failed save can't leave the page showing values the server never took.
  let draft = null;

  function renderDraft() {
    container().innerHTML = renderFields(keys(), draft, fields);
  }

  // Read live from `draft` rather than going through attachFieldEvents, which
  // binds one fixed state object: the draft is replaced on every Edit, and the
  // listener here is attached once for the page's lifetime.
  function handleFieldChange(event) {
    if (!draft) return;

    const input = event.target.closest("[data-field]");
    if (!input) return;

    const key = input.dataset.field;
    const field = fields[key];
    if (!field) return;

    const value = getFieldValue(field, key, input, container());
    const cleared = setFieldValue(draft, fields, key, value);

    // Re-rendered on every change, not only when something was cleared: a change
    // can also *re-enable* a field (ticking is_public un-disables the public
    // narrative), and that only shows up on a re-render. `change` fires on blur
    // for text inputs, so this never interrupts typing.
    renderDraft();

    if (cleared.length) {
      onCleared?.(cleared.map(clearedKey => fields[clearedKey].label).join(", "));
    }
  }

  function startEditing() {
    showTab(editTab);

    draft = createFieldState(fields, record);
    renderDraft();
  }

  function cancelEditing() {
    draft = null;
    showTab(viewTab);
  }

  async function saveEdits() {
    if (!draft) return;

    try {
      const updated = await save(draft);

      // A save helper that swallowed its error returns undefined — treat that as
      // a failure rather than wiping the record with nothing.
      if (!updated) {
        onError?.("Could not save changes.");
        return;
      }

      Object.assign(record, updated);
      draft = null;
      showTab(viewTab);

      await onSaved?.(record);
    } catch (err) {
      console.error(err);
      onError?.(`Could not save changes: ${err.message}`);
    }
  }

  // Listeners attach once. The change handler is delegated to the container,
  // which survives every renderDraft(), so re-attaching per Edit click would
  // stack duplicate handlers — each firing against a stale draft.
  function attach() {
    editButton()?.addEventListener("click", startEditing);
    saveButton()?.addEventListener("click", saveEdits);
    cancelButton()?.addEventListener("click", cancelEditing);
    container()?.addEventListener("change", handleFieldChange);
  }

  return { attach, startEditing, cancelEditing, saveEdits };
}

export { createDetailEditor };
