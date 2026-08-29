// Details view for a record page.
//
// Renders the record's read-only fields and, when editing is allowed, attaches the
// record editor. The page owns the surrounding layout; the editor owns the form.
//
// The view also handles:
// - edit/save/cancel button state
// - save/cancel messages
// - optional post-create content
// - the dashboard's Edit → details navigation

import {
  buildFailureMessage,
  buildSuccessMessage,
  buildWarningMessage,
} from "../components/messages.js";
import {
  CANCEL_BUTTON_ID,
  EDIT_BUTTON_ID,
  EDIT_BUTTONS,
  SAVE_BUTTON_ID,
} from "../components/buttons.js";
import { appendCreateCard } from "../cards/createCard.js";
import { CLEARED_MESSAGE } from "../forms/form.js";
import { buildDisplayFields, buildPanelCards } from "../forms/fields.js";
import { createEditForm } from "../forms/editForm.js";
import { toPanelGroups } from "../schemas/schema.js";
import { getElement, renderHtml } from "../core/render.js";
import { renderPage, renderMessage, clearMessage } from "./pageChrome.js";
import {
  buildHeader,
  buildPage,
  buildSection,
  buildSections,
  getSection,
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
    buildPanelCards(
      toPanelGroups(fields, panels),
      values,
      fields,
      buildDisplayFields,
    ),
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
 * @param onCleared   (labels) => void, when dependent fields are cleared. Omit for the
 *                    standard warning message.
 * @param onDismiss   () => void, when an edit/save/cancel action clears the message.
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
  onDismiss,

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
  }

  function dismissMessage() {
    clearMessage();
    onDismiss?.();
  }

  // Starting any new editor action clears the message from the previous action.
  for (const button of Object.values(buttons)) {
    button?.addEventListener("click", dismissMessage);
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
        renderMessage(buildWarningMessage(CLEARED_MESSAGE, labels));
      }),

    onSaved: async (saved) => {
      renderMessage(
        buildSuccessMessage(`${capitalise(noun)} successfully saved.`),
      );

      renderTitle?.(saved);
      renderRows();

      await onSaved?.(saved);
    },

    onCancel: () => {
      renderRows();
      onCancel?.();
    },

    onError: (error) => {
      renderMessage(buildFailureMessage(`Saving ${noun} failed.`, error));
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

// ─── POST-CREATE ─────────────────────────────────────────────────────────────

// Adds optional content immediately after the details section, typically a "create another"
// or related-action card shown after successfully creating a record.
function renderCreateSection(section, createCard) {
  const element = document.createElement("section");
  const body = document.createElement("div");

  element.className = "page-section";
  body.className = "section-body";

  element.append(body);
  getSection(section).after(element);

  appendCreateCard(body, createCard);

  return element;
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
 * @param back        the back link — `{ text, view }`, or `{ text, href }` to leave the
 *                    page. Omit for no back link.
 * @param canEdit     whether the viewer may edit this record.
 * @param edit        open in edit mode straight away.
 * @param created     whether this record was just created.
 * @param createCard  the card shown after creation. Omit for none.
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
  back,

  canEdit,
  edit = false,

  created = false,
  createCard = null,

  sections = [],
  renderTitle,
}) {
  renderPage(
    buildPage({
      back,
      header: buildHeader(canEdit ? actions : []),
      body: buildSection({ id: noun }) + buildSections(sections),
    }),
  );

  renderTitle(record);
  renderDetails(noun, record, fields, panels);

  if (created) {
    renderMessage(
      buildSuccessMessage(`${capitalise(noun)} successfully created.`),
    );
  }

  if (!canEdit) {
    return null;
  }

  const postCreateSection =
    created && createCard ? renderCreateSection(noun, createCard) : null;

  function attachEditor(options) {
    return attachRecordEditor({
      noun,
      record,
      fields,
      panels,
      edit,
      renderTitle,
      section: noun,

      // The post-create card belongs only to the initial interaction.
      onDismiss: () => {
        postCreateSection?.remove();
      },

      ...options,
    });
  }

  return { attachEditor };
}

// ─── DASHBOARD EDIT LINK ─────────────────────────────────────────────────────

// The dashboard does not contain the editor itself. Its Edit button navigates to the
// details view and asks that view to enter edit mode.
function attachEditLink(router, view = "details") {
  getEditButtons().edit?.addEventListener("click", () => {
    router.goTo(view, { edit: true });
  });
}

export { attachEditLink, attachRecordEditor, renderRecordDetailsView };
