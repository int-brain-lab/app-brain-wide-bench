// Generic "view a record / click Edit / change fields / Save or Cancel" flow for
// a details page. Extracted from the model card so the submission card can use
// the same lifecycle; the pages differ only in their schema, their save call,
// and which DOM ids they use.
//
// One container serves both modes: the caller renders the read-only view into it, this
// replaces that with the form while editing, and the caller's onSaved/onCancel puts the
// read-only view back. It used to assume a pair of `section[data-tab]` panels switched by
// js/tab.js — that stopped being true, but the import lingered and the `showTab` it named
// was never called, so a page still built that way had its form rendered into a section
// nothing ever unhid.

import { createFieldState } from "../fields/state.js";
import { renderFields } from "../fields/render.js";
import { renderGroups } from "../fields/groups.js";
import { createFieldForm } from "../fields/form.js";

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
function Editor({
  container,
  editButton,
  saveButton,
  cancelButton,
  fields,
  keys,
  groups,
  record,
  save,
  onSaved,
  onCleared,
  onError,
  onEdit,
  onCancel,
  context,
}) {
  // Edits accumulate on a draft, never on `record` — so Cancel is free and a
  // failed save can't leave the page showing values the server never took.
  //
  // Null outside editing, which is also how the form below knows to ignore a change:
  // its listener is attached once for the page's lifetime, but the draft it writes to
  // only exists between Edit and Save.
  let draft = null;

  // One section: an editor's fields all live in the container the read-only view was in.
  const form = createFieldForm({
    fields,
    getState: () => draft,

    sections: [{
      container,

      // Drawn from the record merged with the draft, not the draft alone:
      // createFieldState drops every `editable: false` key, so a form that also shows
      // read-only rows for context (an email, a created-at) would render them as "—".
      // The draft is still what gets saved — this merge is display-only.
      //
      // `groups` and `keys` are both thunks so the layout is recomputed per render:
      // a schema whose options arrive late (or a group that becomes empty) is picked
      // up without re-creating the editor.
      draw: state => {
        const values = { ...record, ...state };

        return groups
          ? renderGroups(groups(), values, fields, renderFields)
          : renderFields(keys(), values, fields);
      },
    }],

    onChange: (key, value, cleared) => {
      if (cleared.length) {
        onCleared?.(cleared.map(clearedKey => fields[clearedKey].label).join(", "));
      }
    },
  });

  // The buttons arrive as thunks, not elements — a page can re-render its header
  // and hand back a different node — so they have to be resolved on every call.
  function showButtons(editing) {
    editButton.hidden = editing;
    saveButton.hidden = !editing;
    cancelButton.hidden = !editing;
  }

  function startEditing() {
    showButtons(true);
    onEdit?.();

    // `context` is merged in after createFieldState, which by design keeps only
    // editable fields — so a schema whose predicates read something that *isn't* an
    // editable field would otherwise revalidate against undefined. TASK_FIELDS is the
    // case in point: its disabledOptionsWhen read `task_id` (editable: false) and
    // `model` (not a field at all), and without them every option check silently
    // behaves as though the model were not pretrained.
    //
    // It never reaches the server: `save` decides the payload, not the draft.
    draft = { ...createFieldState(fields, record), ...(context?.() ?? {}) };
    form.render();
  }

  function cancelEditing() {
    draft = null;
    showButtons(false);
    onCancel?.();
  }

  async function saveEdits() {
    if (!draft) return;

    try {

      // TODO only pass in the fields that have changed!
      // iterate through the draft and compare to the record, only send the changed fields to save


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

  // Listeners attach once. The form's change handler is delegated to the container,
  // which survives every re-render, so re-attaching per Edit click would stack
  // duplicate handlers — each firing against a stale draft.
  function attach() {
    editButton.addEventListener("click", startEditing);
    saveButton.addEventListener("click", saveEdits);
    cancelButton.addEventListener("click", cancelEditing);
    form.attach();
  }

  // `startEditing` is exposed for the `&edit` flag: arriving from a list page's Edit link
  // has to open the editor without a button press, and calling this beats synthesising a
  // click on an element found by id.
  return { attach, startEditing };
}

export { Editor };
