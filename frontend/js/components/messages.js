// Messages, in one shape: a headline, whatever detail came with it beneath, and a tone that
// says which kind of news it is.
//
// buildStateNote is the shape; the builders below name the meanings. A state note carrying a
// spinner is work in flight; the rest are answers.

import { escapeHtml } from "../core/html.js";
import { buildIcon } from "./icons.js";

// ─── KINDS ───────────────────────────────────────────────────────────────────

// What each kind of news looks like. Every card carries a mark: an unmarked one reads as a
// different component rather than as quieter news.
//
// `page-error` is toned like a failure and placed like a page. Success has no entry — it is
// an answer with somewhere to go next, so it is built through buildStateNote by whoever
// knows where that is (templates/recordDetails.js, widgets/submissionValidation.js).
const MESSAGE_KINDS = {
  "info-msg": { tone: "quiet", icon: "info" },
  "empty-msg": { tone: "quiet", icon: "info" },
  "warn-msg": { tone: "warned", icon: "alert" },
  "failure-msg": { tone: "failed", icon: "error" },
  "page-error": { tone: "failed standalone", icon: "error" },
};

// ─── BUILDERS ────────────────────────────────────────────────────────────────

/**
 * Where something has got to, and what to do about it — a line, and a quieter one under it.
 *
 * @param line     the headline, as a sentence without its full stop.
 * @param detail   the line under it. Omit for a note with nothing to add.
 * @param tone     "" for work in flight, "quiet" for a note that is only information,
 *                 "done", "warned" or "failed" for an answer.
 * @param icon     a concept from components/icons.js. Omit for no mark. The caller refreshes
 *                 icons, since a note is usually not the only thing it has just written.
 * @param spinner  true for the turning ring work in flight wears, in place of an icon.
 * @param detailId id for the second line, for a note whose detail is rewritten in place.
 *                 Omit for a static one.
 * @param actions  markup for controls at the right-hand end — see components/buttons.js.
 *                 Omit for a note that is only words.
 * @param body     markup under the detail, for a line that has something to enumerate.
 *                 Omit for a note that is only its two lines.
 *
 * @returns the markup.
 */
function buildStateNote({
  line,
  detail = "",
  tone = "",
  icon = "",
  spinner = false,
  detailId = "",
  actions = "",
  body = "",
}) {
  const mark = spinner ? `<span class="spinner"></span>` : icon ? buildIcon(icon) : "";

  const id = detailId ? ` id="${escapeHtml(detailId)}"` : "";

  return `
    <div class="state-note ${escapeHtml(tone)}">
      ${mark}

      <div class="note-text">
        ${escapeHtml(line)}
        ${detail || detailId ? `<span class="sub"${id}>${escapeHtml(detail)}</span>` : ""}
        ${body}
      </div>

      ${actions ? `<span class="note-actions">${actions}</span>` : ""}
    </div>
  `;
}

/**
 * A message in the shared card shape.
 *
 * @param message the headline.
 * @param kind    which news it is — a key of MESSAGE_KINDS. Omit for a quiet note.
 * @param detail  the line beneath. Carries raw server output: apiFetch throws with the whole
 *                response body, and a FastAPI 422 echoes the offending input back.
 *
 * @returns the markup.
 */
function buildMessageCard(message, kind = "info-msg", detail = "") {
  const { tone, icon } = MESSAGE_KINDS[kind] ?? MESSAGE_KINDS["info-msg"];

  return buildStateNote({ line: message, detail, tone, icon });
}

function buildInfoMessage(message) {
  return buildMessageCard(message);
}

// Work in flight, in the region it will fill: the base tone, and the spinner rather than a
// mark, which is what tells a reader it is not an answer yet.
function buildWaitMessage(message) {
  return buildStateNote({ line: message, spinner: true });
}

function buildEmptyMessage(message) {
  return buildMessageCard(message, "empty-msg");
}

function buildWarningMessage(message, detail = "") {
  return buildMessageCard(message, "warn-msg", detail);
}

function buildFailureMessage(message, error) {
  return buildMessageCard(message, "failure-msg", error?.message ?? "");
}

function buildPageErrorMessage(message, error) {
  return buildMessageCard(message, "page-error", error?.message ?? "");
}

export {
  buildEmptyMessage,
  buildFailureMessage,
  buildInfoMessage,
  buildMessageCard,
  buildPageErrorMessage,
  buildStateNote,
  buildWaitMessage,
  buildWarningMessage,
};
