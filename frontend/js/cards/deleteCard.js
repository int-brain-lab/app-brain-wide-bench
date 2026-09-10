// The confirmation a delete has to pass: what is about to go, and the two ways out of it.
//
// Markup only. The widget that mounts it owns the state and the request — see
// widgets/deleteRecord.js.

import { escapeHtml } from "../core/html.js";
import { buildCancelButton, buildDeleteButton } from "../components/buttons.js";

// The card's own footer buttons. Distinct ids: the button that opened the card is still on
// the page behind it, and two elements cannot share one.
const CONFIRM_BUTTON_ID = "delete-confirm";
const ABANDON_BUTTON_ID = "delete-abandon";

// Where the widget writes a failed request's message, inside the card rather than at the top
// of the page: the record is still there, and so is the button that tried.
const MESSAGE_ID = "delete-message";

/**
 * What deleting a record takes with it, over a footer that carries it out or backs away.
 *
 * @param noun  *singular* — "model". Names the record in the sentence.
 * @param name  the record's own name or label.
 * @param items what goes with it, already worded — ["4 submissions", "12 task entries"].
 *              Omit for a record that takes nothing with it.
 *
 * @returns the markup.
 */
function buildDeleteCard({ noun, name, items = [] }) {
  const going = items.length
    ? `
      <p>This will also delete:</p>
      <ul>
        ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    `
    : "";

  return `
    <div class="card danger column gap-lg">
      <div class="column gap-sm">
        <p class="text-lg bold">
          Delete the ${escapeHtml(noun)} ${escapeHtml(name)}?
        </p>
        ${going}
        <p>This cannot be undone.</p>
      </div>

      <div id="${MESSAGE_ID}" hidden></div>

      <div class="row right gap-lg">
        ${buildCancelButton({ id: ABANDON_BUTTON_ID })}
        ${buildDeleteButton({ id: CONFIRM_BUTTON_ID, label: `Delete ${noun}` })}
      </div>
    </div>
  `;
}

export { ABANDON_BUTTON_ID, buildDeleteCard, CONFIRM_BUTTON_ID, MESSAGE_ID };
