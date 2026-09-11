// Page-level rendering: the fixed container, header and message region.
//
// sections.js owns the markup for those regions; this module owns the DOM operations that
// fill them. Views therefore only need to know about these small rendering primitives.

import { buildPageErrorMessage, buildStateNote } from "../components/messages.js";
import { escapeHtml } from "../core/html.js";
import { clearContent, getElement, refreshIcons, renderHtml, setText } from "../core/render.js";
import {
  TITLE_ID,
  DESCRIPTION_ID,
  BADGES_ID,
  MESSAGE_ID,
  buildTitleBadges,
  buildSubtitle,
} from "../components/sections.js";

// The element every page provides and the router replaces when switching views.
const CONTAINER_ID = "container";

// ─── PAGE ────────────────────────────────────────────────────────────────────

function renderPage(html) {
  return renderHtml(CONTAINER_ID, html);
}

// A page that failed before it could render: the error replaces the container, so nothing
// half-built is left behind it.
function renderPageError(message, error) {
  return renderHtml(CONTAINER_ID, buildPageErrorMessage(message, error));
}

/**
 * The whole content area, for a page that cannot be filled in for a reason that is nobody's
 * failure — what is missing, and the control that supplies it.
 *
 * @param line    what is missing.
 * @param detail  why it is needed. Omit where the line says it.
 * @param actions markup for the control that supplies it — see components/buttons.js.
 */
function renderPageNote(line, { detail = "", actions = "" } = {}) {
  return renderHtml(
    CONTAINER_ID,
    buildStateNote({ tone: "quiet standalone", icon: "info", line, detail, actions }),
  );
}

// ─── MESSAGE ─────────────────────────────────────────────────────────────────

// Refreshed: a message may carry a mark of its own, or buttons that do.
function renderMessage(html) {
  return renderHtml(getElement(MESSAGE_ID), html, { show: true, refresh: true });
}

function clearMessage() {
  return clearContent(getElement(MESSAGE_ID), { hide: true });
}

// ─── HEADER ──────────────────────────────────────────────────────────────────

function renderHeader(title, description = "", badges = []) {
  setText(getElement(TITLE_ID), title);

  renderHeaderPart(
    getElement(DESCRIPTION_ID),
    typeof description === "string" ? escapeHtml(description) : buildSubtitle(description),
  );

  renderHeaderPart(getElement(BADGES_ID), buildTitleBadges(badges ?? []));

  refreshIcons();
}

function renderHeaderPart(element, html) {
  renderHtml(element, html);
  element.hidden = !html;
}

export {
  CONTAINER_ID,
  clearMessage,
  renderHeader,
  renderMessage,
  renderPage,
  renderPageError,
  renderPageNote,
};
