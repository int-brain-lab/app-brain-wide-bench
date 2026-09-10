// Delete, in two steps.
//
// The details header's Delete button opens a confirmation naming everything the delete
// takes, in the page's own message region directly under it. Cancel takes it back; Delete
// carries it out. The host supplies the button — see renderRecordDetailsView's `deletable`
// — and the request; this owns which of the two is showing.
//
// Not shown while the editor is open: attachRecordEditor hides the button with the rest of
// the header's actions, so one record only ever offers one action at a time.

import { getElement } from "../core/render.js";
import { ABANDON_BUTTON_ID, buildDeleteCard, CONFIRM_BUTTON_ID } from "../cards/deleteCard.js";
import { DELETE_BUTTON_ID } from "../components/buttons.js";
import { clearMessage, renderMessage } from "../templates/pageChrome.js";

/**
 * A record's delete control, over the Delete button its details header carries.
 *
 * @param noun    *singular* — "model". Names the record in the confirmation.
 * @param name    () => the record's own name or label.
 * @param items   () => what goes with it, worded — ["4 submissions", "12 task entries"].
 *
 *                Both are read at each open rather than captured: the editor above writes
 *                its saved values back into the record it was given, so a rename saved in
 *                the meantime is what the confirmation names.
 * @param remove  async () => void. The request. Rejection leaves the record and reports.
 * @param onDeleted () => void, once the record is gone. Where the page goes next.
 *
 * @returns `{ attach }`. `attach()` wires the header's button.
 */
function createDeleteControl({ noun, name, items, remove, onDeleted }) {
  // ─── STEPS ─────────────────────────────────────────────────────────────────

  // `failure` re-opens the confirmation carrying what the last attempt reported, which is
  // also how it comes back enabled: these are fresh buttons.
  function open(failure = "") {
    renderMessage(buildDeleteCard({ noun, name: name(), items: items(), failure }));

    getElement(ABANDON_BUTTON_ID)?.addEventListener("click", clearMessage);
    getElement(CONFIRM_BUTTON_ID)?.addEventListener("click", confirm);
  }

  // ─── THE REQUEST ───────────────────────────────────────────────────────────

  // Both of the confirmation's buttons, so a second click cannot send a second delete while
  // the first is still in flight. Nothing re-enables them: a failure re-opens it.
  function setBusy(busy) {
    for (const id of [ABANDON_BUTTON_ID, CONFIRM_BUTTON_ID]) {
      const button = getElement(id);

      if (button) button.disabled = busy;
    }
  }

  async function confirm() {
    setBusy(true);

    try {
      await remove();
    } catch (error) {
      console.error(error);
      open(error.message ?? "");

      return;
    }

    onDeleted();
  }

  // ─── LIFECYCLE ─────────────────────────────────────────────────────────────

  // Wrapped: a listener is called with the click event, which is not a failure to report.
  function attach() {
    getElement(DELETE_BUTTON_ID)?.addEventListener("click", () => open());
  }

  return { attach };
}

export { createDeleteControl };
