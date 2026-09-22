// Re-score, in two steps.
//
// The details header's Re-score button opens a confirmation naming the scores the run
// replaces, in the page's own message region directly under it. Cancel takes it back;
// Re-score queues it. The host supplies the button — see renderRecordDetailsView's
// `actions` — and the request; this owns which of the two is showing.
//
// Shown only where the API said the caller may run it — see `can_rescore` on
// SubmissionDetail.

import { getElement } from "../core/render.js";
import { ABANDON_BUTTON_ID, buildRescoreCard, CONFIRM_BUTTON_ID } from "../cards/rescoreCard.js";
import { RESCORE_BUTTON_ID } from "../components/buttons.js";
import { clearMessage, renderMessage } from "../templates/pageChrome.js";

/**
 * A submission's re-score control, over the Re-score button its details header carries.
 *
 * @param name      () => the submission's own label.
 * @param tasks     () => the tasks whose scores the run replaces — ["ts1-choice"].
 *
 *                  Both are read at each open rather than captured: the editor above writes
 *                  its saved values back into the record it was given, so a rename saved in
 *                  the meantime is what the confirmation names.
 * @param rescore   async () => void. The request. Rejection leaves the scores and reports.
 * @param onQueued  () => void, once the run is queued. Where the page goes next.
 *
 * @returns `{ attach }`. `attach()` wires the header's button.
 */
function createRescoreControl({ name, tasks, rescore, onQueued }) {
  // ─── STEPS ─────────────────────────────────────────────────────────────────

  // `failure` re-opens the confirmation carrying what the last attempt reported, which is
  // also how it comes back enabled: these are fresh buttons.
  function open(failure = "") {
    renderMessage(buildRescoreCard({ name: name(), tasks: tasks(), failure }));

    getElement(ABANDON_BUTTON_ID)?.addEventListener("click", clearMessage);
    getElement(CONFIRM_BUTTON_ID)?.addEventListener("click", confirm);
  }

  // ─── THE REQUEST ───────────────────────────────────────────────────────────

  // Both of the confirmation's buttons, so a second click cannot queue a second run while
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
      await rescore();
    } catch (error) {
      console.error(error);
      open(error.message ?? "");

      return;
    }

    onQueued();
  }

  // ─── LIFECYCLE ─────────────────────────────────────────────────────────────

  // Wrapped: a listener is called with the click event, which is not a failure to report.
  function attach() {
    getElement(RESCORE_BUTTON_ID)?.addEventListener("click", () => open());
  }

  return { attach };
}

export { createRescoreControl };
