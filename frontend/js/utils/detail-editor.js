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
  renderGroups,
  setFieldValue,
} from "./form-fields.js";

/**
 * @param container    Element — where the edit form is rendered.
 * @param fields       the schema (MODEL_FIELDS, SUBMISSION_FIELDS, ...).
 * @param keys         () => string[] — which keys the form shows, as one flat
 *                     list. A thunk, not an array, because `fields` can gain
 *                     options asynchronously.
 * @param groups       optional () => [{title, keys, inline}] — renders one card
 *                     per group instead of a flat list. Build it with
 *                     panelGroups(fields, PANELS) to share a layout with the
 *                     read-only view. Takes precedence over `keys`.
 * @param record       the record being edited. Mutated in place on a successful
 *                     save so the surrounding page sees the new values.
 * @param save         async (draft) => updated record (or null/undefined on failure).
 * @param onSaved      optional async (record) => void, after a successful save —
 *                     e.g. re-render the page's tabs.
 * @param onCleared    optional (labels: string) => void, when a change
 *                     invalidated other fields.
 * @param onError      optional (message: string) => void.
 * @param context      optional () => object — extra state merged into the draft that
 *                     the schema's predicates read but that aren't editable fields
 *                     themselves. A thunk, so it can pick up values that load late.

 */
function createDetailEditor({
  container,
  fields,
  keys,
  groups,
  record,
  save,
  onSaved,
  onCleared,
  onError,
  editButton,
  saveButton,
  cancelButton,
  onCancel,
  context,
}) {
  // Edits accumulate on a draft, never on `record` — so Cancel is free and a
  // failed save can't leave the page showing values the server never took.
  let draft = null;

  // Rendered from the record merged with the draft, not the draft alone:
  // createFieldState drops every `editable: false` key, so a form that also shows
  // read-only rows for context (an email, a created-at) would render them as "—".
  // The draft is still what gets saved — this merge is display-only.
  //
  // `groups` and `keys` are both thunks so the layout is recomputed per render:
  // a schema whose options arrive late (or a group that becomes empty) is picked
  // up without re-creating the editor.
  function renderDraft() {
    const state = { ...record, ...draft };

    container.innerHTML = groups
      ? renderGroups(groups(), state, fields, renderFields)
      : renderFields(keys(), state, fields);

    // The form's `editable: false` keys render as display rows, which carry the
    // `icon` placeholders — so the edit view needs createIcons() too, or a
    // read-only field with an icon would show an empty <i> here while looking
    // right on the read-only view.
    globalThis.lucide?.createIcons?.();
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

    const value = getFieldValue(field, key, input, container);
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

  // The buttons arrive as thunks, not elements — a page can re-render its header
  // and hand back a different node — so they have to be resolved on every call.
  function showButtons(editing) {
    editButton.hidden = editing;
    saveButton.hidden = !editing;
    cancelButton.hidden = !editing;
  }

  function startEditing() {
    showButtons(true);

    // `context` is merged in after createFieldState, which by design keeps only
    // editable fields — so a schema whose predicates read something that *isn't* an
    // editable field would otherwise revalidate against undefined. TASK_FIELDS is the
    // case in point: its disabledOptionsWhen read `task_id` (editable: false) and
    // `model` (not a field at all), and without them every option check silently
    // behaves as though the model were not pretrained.
    //
    // It never reaches the server: `save` decides the payload, not the draft.
    draft = { ...createFieldState(fields, record), ...(context?.() ?? {}) };
    renderDraft();
  }

  function cancelEditing() {
    draft = null;
    showButtons(false);
    onCancel?.();
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
      showButtons(false);

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
    editButton.addEventListener("click", startEditing);
    saveButton.addEventListener("click", saveEdits);
    cancelButton.addEventListener("click", cancelEditing);
    container.addEventListener("change", handleFieldChange);
  }

  return { attach, startEditing, cancelEditing, saveEdits };
}

export { createDetailEditor };
