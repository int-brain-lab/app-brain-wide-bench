// The confirmation a re-score has to pass: which scores it replaces, and the two ways out
// of it.
//
// A state note in the caution tone — see components/messages.js — so a confirmation reads
// like every other answer the app gives. Markup only: the widget that mounts it owns the
// state and the request, and re-renders it to report one that failed. See
// widgets/rescoreRecord.js.

import { escapeHtml } from "../core/html.js";
import { buildCancelButton, buildRescoreButton } from "../components/buttons.js";
import { buildStateNote } from "../components/messages.js";

// The note's own buttons. Distinct ids: the button that opened it is still on the page
// behind it, and two elements cannot share one.
const CONFIRM_BUTTON_ID = "rescore-confirm";
const ABANDON_BUTTON_ID = "rescore-abandon";

/**
 * What a re-score replaces, over the controls that carry it out or back away.
 *
 * @param name    the submission's own label.
 * @param tasks   the tasks it entered, worded — ["ts1-choice", "ts1-reward"]. Omit for a
 *                submission whose tasks are not to be named.
 * @param failure what the last attempt reported. Omit before there has been one.
 *
 * @returns the markup.
 */
function buildRescoreCard({ name, tasks = [], failure = "" }) {
  const going = tasks.length
    ? `
      <div class="sub">
        This replaces the scores on:
        <ul class="note-list">
          ${tasks.map((task) => `<li>${escapeHtml(task)}</li>`).join("")}
        </ul>
      </div>
    `
    : "";

  // In the note rather than beside it: a second card under this one would read as more of
  // the same card, and the button that tried is still right here.
  const trouble = failure
    ? `
      <div class="sub">
        <span class="bold">Re-scoring failed.</span>
        ${escapeHtml(failure)}
      </div>
    `
    : "";

  return buildStateNote({
    tone: "warned",
    icon: "alert",
    line: `Re-score ${name}?`,
    detail: "The scores it has now stand until the run finishes, and are replaced when it does.",
    body: going + trouble,

    actions:
      buildCancelButton({ id: ABANDON_BUTTON_ID }) + buildRescoreButton({ id: CONFIRM_BUTTON_ID }),
  });
}

export { ABANDON_BUTTON_ID, buildRescoreCard, CONFIRM_BUTTON_ID };
