// Delete, in two steps.
//
// A section holding one red button; pressing it swaps the button for a card naming
// everything the delete takes, over Cancel and a second red Delete. The host supplies the
// section and the request; this owns which of the two is showing.
//
// Mounted by the details view of a record page, at the foot. Hidden while the editor above
// it is open — see setEditing.

import { getElement, renderHtml } from "../core/render.js";
import {
  ABANDON_BUTTON_ID,
  buildDeleteCard,
  CONFIRM_BUTTON_ID,
  MESSAGE_ID,
} from "../cards/deleteCard.js";
import { buildDeleteButton, DELETE_BUTTON_ID } from "../components/buttons.js";
import { buildFailureMessage } from "../components/messages.js";
import { getSection, getSectionBody } from "../components/sections.js";

/**
 * A record's delete control, over the section the host built for it.
 *
 * @param section the id of the section to render into.
 * @param noun    *singular* — "model". Names the record in the button and the card.
 * @param name    () => the record's own name or label.
 * @param items   () => what goes with it, worded — ["4 submissions", "12 task entries"].
 *
 *                Both are read at each open rather than captured: the editor above writes
 *                its saved values back into the record it was given, so a rename saved in
 *                the meantime is what the confirmation names.
 * @param remove  async () => void. The request. Rejection leaves the record and reports.
 * @param onDeleted () => void, once the record is gone. Where the page goes next.
 *
 * @returns { render, setEditing }. `render()` to draw the button; `setEditing(true)` to hide
 *          the section while the editor above it is open.
 */
function createDeleteSection({ section, noun, name, items, remove, onDeleted }) {
  // ─── STEPS ─────────────────────────────────────────────────────────────────

  function renderButton() {
    renderHtml(getSectionBody(section), buildDeleteButton({ label: `Delete ${noun}` }), {
      refresh: true,
    });

    getElement(DELETE_BUTTON_ID)?.addEventListener("click", renderConfirmation);
  }

  function renderConfirmation() {
    renderHtml(getSectionBody(section), buildDeleteCard({ noun, name: name(), items: items() }), {
      refresh: true,
    });

    getElement(ABANDON_BUTTON_ID)?.addEventListener("click", renderButton);
    getElement(CONFIRM_BUTTON_ID)?.addEventListener("click", confirm);
  }

  // ─── THE REQUEST ───────────────────────────────────────────────────────────

  // Both footer buttons, so a second click cannot send a second delete while the first is
  // still in flight.
  function setBusy(busy) {
    for (const id of [ABANDON_BUTTON_ID, CONFIRM_BUTTON_ID]) {
      const button = getElement(id);

      if (button) button.disabled = busy;
    }
  }

  function renderFailure(error) {
    renderHtml(MESSAGE_ID, buildFailureMessage(`Deleting the ${noun} failed.`, error), {
      show: true,
    });
  }

  async function confirm() {
    setBusy(true);

    try {
      await remove();
    } catch (error) {
      console.error(error);
      setBusy(false);
      renderFailure(error);

      return;
    }

    onDeleted();
  }

  // ─── LIFECYCLE ─────────────────────────────────────────────────────────────

  // The whole section, not just the button: a heading reading "Delete this model" over
  // nothing is worse than no heading.
  function setEditing(editing) {
    const element = getSection(section);

    if (element) element.hidden = editing;

    if (!editing) renderButton();
  }

  return { render: renderButton, setEditing };
}

export { createDeleteSection };
