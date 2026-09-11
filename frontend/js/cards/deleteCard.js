// The confirmation a delete has to pass: what is about to go, and the two ways out of it.
//
// A state note in the danger tone — see components/messages.js — so a confirmation reads
// like every other answer the app gives. Markup only: the widget that mounts it owns the
// state and the request, and re-renders it to report one that failed. See
// widgets/deleteRecord.js.

import { escapeHtml } from "../core/html.js";
import { buildCancelButton, buildDeleteButton } from "../components/buttons.js";
import { buildStateNote } from "../components/messages.js";

// The note's own buttons. Distinct ids: the button that opened it is still on the page
// behind it, and two elements cannot share one.
const CONFIRM_BUTTON_ID = "delete-confirm";
const ABANDON_BUTTON_ID = "delete-abandon";

/**
 * What deleting a record takes with it, over the controls that carry it out or back away.
 *
 * @param noun    *singular* — "model". Names the record in the question.
 * @param name    the record's own name or label.
 * @param items   what goes with it, already worded — ["4 submissions", "12 task entries"].
 *                Omit for a record that takes nothing with it.
 * @param failure what the last attempt reported. Omit before there has been one.
 *
 * @returns the markup.
 */
function buildDeleteCard({ noun, name, items = [], failure = "" }) {
  const going = items.length
    ? `
      <div class="sub">
        This will also delete:
        <ul class="delete-list">
          ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </div>
    `
    : "";

  // In the note rather than beside it: a second red card under this one would read as more
  // of the same card, and the button that tried is still right here.
  const trouble = failure
    ? `
      <div class="sub">
        <span class="bold">Deleting the ${escapeHtml(noun)} failed.</span>
        ${escapeHtml(failure)}
      </div>
    `
    : "";

  return buildStateNote({
    tone: "failed",
    icon: "alert",
    line: `Delete the ${noun} ${name}?`,
    detail: "This cannot be undone.",
    body: going + trouble,

    actions:
      buildCancelButton({ id: ABANDON_BUTTON_ID }) +
      buildDeleteButton({ id: CONFIRM_BUTTON_ID, label: `Delete ${noun}` }),
  });
}

export { ABANDON_BUTTON_ID, buildDeleteCard, CONFIRM_BUTTON_ID };
