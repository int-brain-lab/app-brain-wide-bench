// Details view for a record page.
//
// Renders the record's read-only fields and, when editing is allowed, attaches the
// record editor. The page owns the surrounding layout; the editor owns the form.
//
// The view also handles:
// - edit/save/cancel button state
// - save/cancel messages
// - the message a just-created record wears, and the two ways on from it
// - the dashboard's Edit → details navigation

import {
  buildFailureMessage,
  buildStateNote,
  buildWarningMessage,
} from "../components/messages.js";
import {
  buildButton,
  buildCreateButton,
  buildDeleteButton,
  CANCEL_BUTTON_ID,
  DELETE_BUTTON_ID,
  EDIT_BUTTON_ID,
  EDIT_BUTTONS,
  SAVE_BUTTON_ID,
} from "../components/buttons.js";
import { getIcon } from "../components/icons.js";
import { CLEARED_MESSAGE } from "../forms/form.js";
import { buildDisplayFields, buildPanelCards } from "../forms/fields.js";
import { createEditForm } from "../forms/editForm.js";
import { toPanelGroups } from "../schemas/schemaPanels.js";
import { getElement, renderHtml } from "../core/render.js";
import { renderPage, renderMessage, clearMessage } from "./pageChrome.js";
import {
  buildHeader,
  buildPage,
  buildSection,
  buildSections,
  getSectionBody,
} from "../components/sections.js";

// ─── HELPERS ─────────────────────────────────────────────────────────────────

// The editor's buttons are rendered as part of the page header, so resolve them after the
// page has been rendered rather than keeping references across page renders.
function getEditButtons() {
  return {
    edit: getElement(EDIT_BUTTON_ID),
    save: getElement(SAVE_BUTTON_ID),
    cancel: getElement(CANCEL_BUTTON_ID),
  };
}

function capitalise(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

// ─── DETAILS ─────────────────────────────────────────────────────────────────

function renderDetails(section, values, fields, panels) {
  renderHtml(
    getSectionBody(section),
    buildPanelCards(toPanelGroups(fields, panels), values, fields, buildDisplayFields),
  );
}

// ─── EDITOR ──────────────────────────────────────────────────────────────────

/**
 * An editor over an already-rendered details view.
 *
 * @param noun        *singular* — "model". Names the record in the save messages.
 * @param record      the record being edited.
 * @param fields      field definitions for the editor.
 * @param panels      panel definitions for the details view and the editor.
 * @param save        async (changes) => the saved record.
 * @param edit        open in edit mode straight away, for the one-shot `?edit` flag.
 * @param renderTitle (record) => void, after a successful save, so the header follows the
 *                    new values.
 * @param context     () => object. Extra state for field predicates, kept out of the
 *                    save payload. Omit for a record that needs none.
 * @param onEdit      () => void, when editing starts.
 * @param onSaved     async (saved) => void, after a successful save.
 * @param onCancel    () => void, after cancelling.
 * @param onCleared   (labels) => void, after every change — see createEditForm. Omit for the
 *                    standard warning, which is taken back by the next change that clears
 *                    nothing.
 * @param savedNote   (saved) => `{ line, detail }` — what the saved message says, where the
 *                    page can put it better than "{Noun} successfully updated". Omit for
 *                    that.
 * @param dashboard   true where this record's page has a `dashboard` view, which the saved
 *                    message then offers a button to. A string labels that button instead of
 *                    the default "Go to {noun} dashboard".
 * @param section     the section holding the editable fields.
 *
 * @returns the editor, already attached.
 */
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
  savedNote,

  dashboard = false,
  section = "record",
}) {
  const buttons = getEditButtons();
  const container = getSectionBody(section);

  // ─── VIEW ──────────────────────────────────────────────────────────────────

  function renderRows() {
    renderDetails(section, record, fields, panels);
  }

  // ─── BUTTONS ───────────────────────────────────────────────────────────────

  function setEditingState(editing) {
    buttons.edit?.toggleAttribute("hidden", editing);
    buttons.save?.toggleAttribute("hidden", !editing);
    buttons.cancel?.toggleAttribute("hidden", !editing);

    // Deliberately not in `buttons`: every button there also clears the page's message,
    // which is where the delete confirmation is drawn — it would wipe it as it opened.
    getElement(DELETE_BUTTON_ID)?.toggleAttribute("hidden", editing);
  }

  // Starting any new editor action clears the message from the previous action.
  for (const button of Object.values(buttons)) {
    button?.addEventListener("click", clearMessage);
  }

  // ─── EDITOR ────────────────────────────────────────────────────────────────

  const editor = createEditForm({
    container,
    record,
    fields,

    panelGroups: () => toPanelGroups(fields, panels, { columns: 1 }),

    save,
    context,
    onEdit,

    onEditingChange: setEditingState,

    onCleared:
      onCleared ??
      ((labels) => {
        if (labels) {
          renderMessage(buildWarningMessage(CLEARED_MESSAGE, labels));
        } else {
          clearMessage();
        }
      }),

    onSaved: async (saved) => {
      renderSavedMessage(noun, dashboard, savedNote?.(saved));

      renderTitle?.(saved);
      renderRows();

      await onSaved?.(saved);
    },

    onCancel: () => {
      renderRows();
      onCancel?.();
    },

    onError: (error) => {
      renderMessage(buildFailureMessage(`Updating ${noun} failed`, error));
    },
  });

  // Event delegation inside the form means this only needs to be attached once.
  editor.attach();

  buttons.edit?.addEventListener("click", editor.startEdit);
  buttons.save?.addEventListener("click", editor.saveEdit);
  buttons.cancel?.addEventListener("click", editor.cancelEdit);

  // Used by the one-shot `?edit` URL flag.
  if (edit) {
    editor.startEdit();
  }

  return editor;
}

// ─── ANSWERS ─────────────────────────────────────────────────────────────────

// `view` rather than an href, so the router switches in place — see core/router.js, whose
// listener is delegated and so reaches a button rendered as late as a message.
function buildDashboardButton(noun, dashboard) {
  return buildButton({
    label: typeof dashboard === "string" ? dashboard : `Go to ${noun} dashboard`,
    view: "dashboard",
    icon: getIcon("dashboard"),
  });
}

// The record exists; these are the ways on from it.
function buildCreatedActions(noun, next, dashboard) {
  const create = next
    ? buildCreateButton({ href: next.href, label: next.label })
    : "";

  return (dashboard ? buildDashboardButton(noun, dashboard) : "") + create;
}

function renderCreatedMessage(noun, next, dashboard) {
  renderMessage(
    buildStateNote({
      tone: "done",
      icon: "tick",
      line: `${capitalise(noun)} successfully created`,
      detail: next?.detail ?? "",
      actions: buildCreatedActions(noun, next, dashboard),
    }),
  );
}

function renderSavedMessage(noun, dashboard, note) {
  renderMessage(
    buildStateNote({
      tone: "done",
      icon: "tick",
      line: note?.line ?? `${capitalise(noun)} successfully updated`,
      detail: note?.detail ?? "",
      actions: dashboard ? buildDashboardButton(noun, dashboard) : "",
    }),
  );
}

// ─── DETAILS VIEW ────────────────────────────────────────────────────────────

/**
 * A record's details view, read-only until the caller attaches an editor.
 *
 * @param noun        *singular* — "model". Names the section and the messages.
 * @param record      the record to display.
 * @param fields      field definitions for the record.
 * @param panels      panel definitions setting out the field layout.
 * @param actions     header actions, shown only when editing is allowed.
 * @param deletable   add Delete to those actions, for a page that mounts a delete control
 *                    over it — see widgets/deleteRecord.js. Omit for a record with none.
 * @param canEdit     whether the viewer may edit this record.
 * @param edit        open in edit mode straight away.
 * @param created     whether this record was just created.
 * @param createdNext `{ detail, href, label }` — the sentence and the create button the
 *                    just-created message offers. Omit for a message with nothing beyond
 *                    the news.
 * @param dashboard   true where this record's page has a `dashboard` view. The created and
 *                    saved messages then offer a button to it; a string labels that button
 *                    instead of the default "Go to {noun} dashboard".
 * @param sections    further sections rendered below the record's own.
 * @param renderTitle (record) => void. Writes the page header.
 *
 * @returns `{ attachEditor }` when editing is allowed, otherwise null. `attachEditor` takes
 *          the save behaviour, so this view never touches the API.
 */
function renderRecordDetailsView({
  noun = "record",

  record,
  fields,
  panels,

  actions = EDIT_BUTTONS,
  deletable = false,

  canEdit,
  edit = false,

  created = false,
  createdNext = null,
  dashboard = false,

  sections = [],
  renderTitle,
}) {
  const headerActions = deletable ? [...actions, buildDeleteButton()] : actions;

  renderPage(
    buildPage({
      header: buildHeader(canEdit ? headerActions : []),
      body: buildSection({ id: noun }) + buildSections(sections),
    }),
  );

  renderTitle(record);
  renderDetails(noun, record, fields, panels);

  if (created) {
    renderCreatedMessage(noun, canEdit ? createdNext : null, dashboard);
  }

  if (!canEdit) {
    return null;
  }

  function attachEditor(options) {
    return attachRecordEditor({
      noun,
      record,
      fields,
      panels,
      edit,
      renderTitle,
      dashboard,
      section: noun,

      ...options,
    });
  }

  return { attachEditor };
}

export { attachRecordEditor, renderRecordDetailsView };
