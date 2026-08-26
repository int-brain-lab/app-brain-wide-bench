// The inline editor of a record's details view: the Edit / Save / Cancel trio in the header,
// the form that replaces the read-only rows, and the messages both produce.
//
// Not a page and not a route — the record stays on the view it was already on, and the
// router knows nothing about editing. This is the piece of `VIEWS.details` that was written
// out five times: every view named the same three actions, found the same three buttons by
// id, rendered the same groups at one column, reported errors to the same message region,
// and re-rendered its details on both save and cancel.
//
// What a view still owns is what actually differs: how the record is saved, whether saving
// renames it, and whatever else belongs to edit mode — a members block to unlock, an
// apply-to-suite checkbox to reveal. Those arrive as hooks that run *after* the standard
// behaviour, so a view adds to it rather than restating it.

import {
  clearMessage,
  showFailure,
  showSuccess,
  showWarning,
} from "../core/utils.js";
import { CLEARED_MESSAGE } from "../forms/form.js";
import { panelGroups } from "../schemas/schema.js";
import { Editor } from "../forms/edit-form.js";
import {
  clearPostCreate,
  editButtons,
  pageMessage,
  renderDetails,
  sectionBody,
} from "./record-page.js";

/**
 * @param noun         What is being edited — "model", "team". Names it in the card that
 *                     reports the save, so every view says the same thing the same way.
 *
 * @param record       The record being edited. Mutated in place on a successful save, so the
 *                     surrounding view sees the new values.
 *
 * @param fields       The schema (MODEL_FIELDS, TASK_FIELDS, ...).
 *
 * @param panels       The panel layout, used for both the read-only rows and the form, which
 *                     is what makes the two modes line up. Forced to one column while
 *                     editing: inputs want the card's full width.
 *
 * @param save         async (draft) => updated record. The one thing no default can supply.
 *
 * @param edit         true to open the editor immediately — the `&edit` flag, set when a
 *                     list page's Edit link sent the user here.
 *
 * @param renderTitle  Optional (saved) => void, for a record whose name is in the page
 *                     header: a rename has to reach the title as well as the rows.
 *
 * @param context      Optional () => object, passed to the editor — extra state the schema's
 *                     predicates read that isn't an editable field. See editor.js.
 *
 * @param onEdit       Optional () => void, when edit mode opens.
 *
 * @param onSaved      Optional (saved) => void, after the message is cleared, the title
 *                     re-rendered and the rows redrawn. Where a view writes its own report of
 *                     what the save did.
 *
 * @param onCancel     Optional () => void, after the rows are restored.
 *
 * @param onCleared    Optional (labels) => void, when a change invalidated other fields.
 *                     Defaults to naming them in the page message, which is what every
 *                     dependent schema wants.
 *
 * @returns the editor, already attached.
 */
function capitalise(noun) {
  return noun.charAt(0).toUpperCase() + noun.slice(1);
}

function attachRecordEditor({
  noun = "record",
  record,
  fields,
  panels,
  save,
  edit = false,
  renderTitle,
  context,
  onEdit,
  onSaved,
  onCancel,
  onCleared,
}) {
  function renderRows(current) {
    renderDetails(current, fields, panels);
  }

  const buttons = editButtons();

  // Edit, Save and Cancel all mean the user has moved on, so whatever the last change or
  // save said is stale — and left up under a fresh edit it reads as a response to this
  // click. Registered before Editor's own handlers, so a save that reports something writes
  // into a region this has just emptied.
  for (const button of Object.values(buttons)) {
    button?.addEventListener("click", () => {
      clearMessage(pageMessage());

      // The post-create card says "you have just made this and it has nothing in it yet",
      // which stops being the interesting thing the moment the user acts on the record.
      clearPostCreate();
    });
  }

  const editor = Editor({
    container: sectionBody("body"),
    ...buttons,
    record,
    fields,
    groups: () => panelGroups(fields, panels, { columns: 1 }),
    save,
    context,
    onEdit,

    onCleared:
      onCleared ??
      ((labels) => {
        showWarning(pageMessage(), CLEARED_MESSAGE, labels);
      }),

    // The standard report goes up first and the rows are redrawn before the hook runs, so a
    // view with something better to say — which tasks a task edit actually changed — writes
    // over it while looking at the saved record.
    onSaved: (saved) => {
      showSuccess(pageMessage(), `${capitalise(noun)} successfully saved.`);
      renderTitle?.(saved);
      renderRows(saved);

      return onSaved?.(saved);
    },

    // `record` rather than the draft: cancelling is meant to put back what was there.
    onCancel: () => {
      renderRows(record);
      onCancel?.();
    },

    onError: (error) =>
      showFailure(pageMessage(), `Saving ${noun} failed.`, error),
  });

  editor.attach();

  if (edit) {
    editor.startEditing();
  }

  return editor;
}

// A dashboard view offers Edit as well, but as a way *into* the details view, where the
// editor lives — there is nothing on a dashboard to save. Same button and the same id, so
// the jump belongs here beside the editor rather than being written out per view, which is
// also what keeps the ids from leaking back out of this module.
function attachEditLink(router, view = "details") {
  editButtons().editButton?.addEventListener("click", () => {
    router.goTo(view, { edit: true });
  });
}

export { attachEditLink, attachRecordEditor };
