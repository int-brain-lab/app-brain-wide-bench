// Generic "view a record / click Edit / change fields / Save or Cancel" flow for a details
// page.
//
// The caller owns the page and its controls. This editor owns only the supplied container:
// entering edit mode replaces its read-only contents with the form, and leaving edit mode
// lets the caller render the read-only view again.
//
// Edits are made against a draft, so Cancel is free and a failed save cannot modify the
// record shown by the page.

import { buildFields, buildPanelCards } from "./fields.js";
import { clearedLabels, createFieldForm, createFieldState } from "./form.js";

// ─── HELPERS ─────────────────────────────────────────────────────────────────

// null and undefined both mean "unset".
// Arrays are compared as sets because checkbox-list order is determined by the schema.
function sameValue(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    const left = [...(a ?? [])].sort();
    const right = [...(b ?? [])].sort();

    return (
      left.length === right.length &&
      left.every((value, index) => value === right[index])
    );
  }

  return (a ?? null) === (b ?? null);
}

// Return only fields that actually changed.
//
// The PATCH endpoint accepts a partial body, so untouched fields must not be included.
// Fields outside the schema, such as `context`, are excluded automatically.
function getChanges(draft, record, fields) {
  return Object.fromEntries(
    Object.keys(fields)
      .filter((key) => key in draft && !sameValue(draft[key], record[key]))
      .map((key) => [key, draft[key]]),
  );
}

// ─── EDITOR ──────────────────────────────────────────────────────────────────

/**
 * An editor over one container: view, Edit, change, then Save or Cancel.
 *
 * @param container       element the edit form is rendered into.
 * @param fields          field definitions.
 * @param keys            () => string[]. The fields to display, flat.
 * @param panelGroups     () => the panels resolved to their keys, from schema.js's
 *                        toPanelGroups — one card each. A thunk, so it picks up options the
 *                        fields gain after this is built. Takes precedence over `keys`.
 *                        Omit for one flat list.
 * @param record          the record being edited, updated in place after a successful save.
 * @param save            async (changes) => the updated record.
 * @param onEditingChange (editing) => void, as edit mode opens and closes. Omit for a
 *                        caller with no controls to update.
 * @param onSaved         async (record) => void, after a successful save. Omit for none.
 * @param onCleared       (labels) => void, when a change invalidates other fields. Omit for
 *                        no notice.
 * @param onError         (error) => void, when saving fails. Omit to fail silently.
 * @param onEdit          () => void, when edit mode opens. Omit for none.
 * @param onCancel        () => void, after cancelling. Omit for none.
 * @param context         () => object. Extra state for field predicates, never part of the
 *                        save payload. Omit for a record that needs none.
 *
 * @returns `{ attach, startEdit, cancelEdit, saveEdit }`. The caller wires the last three
 *          to its own buttons.
 */
function createEditForm({
  container,
  onEditingChange,

  fields,
  keys,
  panelGroups,

  record,
  save,

  onSaved,
  onCleared,
  onError,
  onEdit,
  onCancel,

  context,
}) {
  // The form edits this object rather than the record itself.
  // null means that edit mode is inactive.
  let editState = null;

  // ─── FORM ──────────────────────────────────────────────────────────────────

  const form = createFieldForm({
    fields,

    getState: () => editState,

    sections: [
      {
        container,

        draw: (state) => {
          // Include the record's read-only values when rendering.
          // createFieldState only contains editable fields.
          const values = {
            ...record,
            ...state,
          };

          return panelGroups
            ? buildPanelCards(panelGroups(), values, fields, buildFields)
            : buildFields(keys(), values, fields);
        },
      },
    ],

    onChange: (key, value, cleared) => {
      if (cleared.length) {
        onCleared?.(clearedLabels(fields, cleared));
      }
    },
  });

  // ─── EDITING ───────────────────────────────────────────────────────────────

  function startEdit() {
    onEditingChange?.(true);
    onEdit?.();

    // Start with the record's editable values, then add any extra context
    // required by field predicates. Context is never sent to `save()`.
    editState = {
      ...createFieldState(fields, record),
      ...(context?.() ?? {}),
    };

    form.render();
  }

  function cancelEdit() {
    editState = null;

    onEditingChange?.(false);
    onCancel?.();
  }

  // ─── SAVING ────────────────────────────────────────────────────────────────

  async function saveEdit() {
    if (!editState) return;

    try {
      const changes = getChanges(editState, record, fields);

      const updated = await save(changes);

      // A missing result means the save helper failed without throwing.
      if (!updated) {
        onError?.(new Error("The server returned no record."));
        return;
      }

      Object.assign(record, updated);

      editState = null;
      onEditingChange?.(false);

      await onSaved?.(record);
    } catch (error) {
      console.error(error);
      onError?.(error);
    }
  }

  // ─── LIFECYCLE ─────────────────────────────────────────────────────────────

  // Attach once. The form delegates its events to the container, which survives
  // every re-render, so attaching again for each edit would create duplicate listeners.
  function attach() {
    form.attach();
  }

  return {
    attach,
    startEdit,
    cancelEdit,
    saveEdit,
  };
}

export { createEditForm };
