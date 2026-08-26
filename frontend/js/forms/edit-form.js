// Generic "view a record / click Edit / change fields / Save or Cancel" flow for a details
// page; the pages differ only in their schema, their save call and their buttons.
//
// One container serves both modes: the caller renders the read-only view into it, this
// replaces that with the form while editing, and the caller's onSaved/onCancel puts the
// read-only view back.

import { createFieldState } from "../schemas/schema.js";
import { buildFields, buildGroupCards } from "./fields.js";
import { createFieldForm } from "./form.js";

/**
 * @param container    Element — where the edit form is rendered.
 * @param editButton   Element — shown outside edit mode, and what opens it.
 * @param saveButton   Element — shown while editing.
 * @param cancelButton Element — shown while editing.
 *
 *                     All three are resolved once, at construction (record-page.js's
 *                     editButtons() finds them by id), so a page that re-renders its header
 *                     afterwards leaves this editor holding detached nodes.
 *
 * @param fields       the schema (MODEL_FIELDS, SUBMISSION_FIELDS, ...).
 * @param keys         () => string[] — the keys to show, as one flat list. A thunk, not
 *                     an array, because `fields` can gain options asynchronously.
 * @param groups       optional () => [{title, keys, inline}] — one card per group instead
 *                     of a flat list, built with panelGroups(fields, PANELS) to share a
 *                     layout with the read-only view. Takes precedence over `keys`.
 * @param record       the record being edited. Mutated in place on a successful save, so
 *                     the surrounding page sees the new values.
 * @param save         async (changes) => updated record (or null/undefined on failure).
 *                     `changes` is only the fields the user edited, ready for a PATCH.
 * @param onSaved      optional async (record) => void, after a successful save —
 *                     e.g. re-render the page's tabs.
 * @param onCleared    optional (labels: string) => void, when a change
 *                     invalidated other fields.
 * @param onError      optional (error: Error) => void. The error itself, so the caller
 *                     decides how to word the failure and what to do with the detail.
 * @param onEdit       optional () => void, as edit mode opens — before the draft is built,
 *                     so it can set up whatever `context` will be read from.
 * @param onCancel     optional () => void, after the draft is discarded.
 * @param context      optional () => object — state the schema's predicates read that
 *                     isn't an editable field. A thunk, so it picks up late values.
 */
// null and undefined both mean "unset" here: a text input that was cleared reads back as
// null, while a record that never carried the value arrives undefined. Arrays are compared
// as sets — a checkbox list's order follows the schema's options, not the user's clicks.
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

// What the user actually changed. Every PATCH endpoint takes a partial body
// (`exclude_unset`), so naming untouched fields would write values this page read minutes
// ago over whatever has changed since — and on a task submission it would null the four
// fields the user didn't touch, which is the case tasksubmissions.py calls out by name.
//
// Keyed off the schema rather than the draft, which also keeps `context` out of the
// payload: those extras are there for the schema's predicates to read, not to be saved.
function changedFields(draft, record, fields) {
  return Object.fromEntries(
    Object.keys(fields)
      .filter((key) => key in draft && !sameValue(draft[key], record[key]))
      .map((key) => [key, draft[key]]),
  );
}

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
  // Edits accumulate on a draft, never on `record`, so Cancel is free and a failed save
  // can't leave the page showing values the server never took. Null outside editing, which
  // is also how the form knows to ignore a change: its listener outlives the draft.
  let draft = null;

  // One section: an editor's fields all live in the container the read-only view was in.
  const form = createFieldForm({
    fields,
    getState: () => draft,

    sections: [
      {
        container,

        // Record merged with draft, not the draft alone: createFieldState drops every
        // `editable: false` key, so read-only context rows would render as "—". Display
        // only — the draft is still what gets saved.
        draw: (state) => {
          const values = { ...record, ...state };

          return groups
            ? buildGroupCards(groups(), values, fields, buildFields)
            : buildFields(keys(), values, fields);
        },
      },
    ],

    onChange: (key, value, cleared) => {
      if (cleared.length) {
        onCleared?.(
          cleared.map((clearedKey) => fields[clearedKey].label).join(", "),
        );
      }
    },
  });

  function showButtons(editing) {
    editButton.hidden = editing;
    saveButton.hidden = !editing;
    cancelButton.hidden = !editing;
  }

  function startEditing() {
    showButtons(true);
    onEdit?.();

    // createFieldState keeps only editable fields, so a predicate reading anything else
    // would revalidate against undefined — TASK_FIELDS reads `task_id` and `model`, and
    // without them every option check behaves as though the model were not pretrained.
    // `context` never reaches the server: `save` decides the payload.
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
      // Always called, even with nothing to send: a save can do more than the fields — the
      // team editor applies its member changes in there — and an empty PATCH is a no-op the
      // server answers with the current record.
      const updated = await save(changedFields(draft, record, fields));

      // A save helper that swallowed its error returns undefined — a failure, not a
      // reason to wipe the record.
      if (!updated) {
        onError?.(new Error("The server returned no record."));
        return;
      }

      Object.assign(record, updated);
      draft = null;
      showButtons(false);

      await onSaved?.(record);
    } catch (err) {
      console.error(err);
      onError?.(err);
    }
  }

  // Once only: the form's handler is delegated to the container, which survives every
  // re-render, so re-attaching per Edit click would stack duplicates.
  function attach() {
    editButton.addEventListener("click", startEditing);
    saveButton.addEventListener("click", saveEdits);
    cancelButton.addEventListener("click", cancelEditing);
    form.attach();
  }

  // `startEditing` is exposed for the `&edit` flag, which opens the editor with no click.
  return { attach, startEditing };
}

export { Editor };
