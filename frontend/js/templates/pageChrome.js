// Page-level rendering: the fixed container, header and message region.
//
// sections.js owns the markup for those regions; this module owns the DOM operations that
// fill them. Views therefore only need to know about these small rendering primitives.

import { buildPageErrorMessage } from "../components/messages.js";
import { escapeHtml } from "../core/html.js";
import {
  clearContent,
  getElement,
  refreshIcons,
  renderHtml,
  setText,
} from "../core/render.js";
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

// ─── MESSAGE ─────────────────────────────────────────────────────────────────

function renderMessage(html) {
  return renderHtml(getElement(MESSAGE_ID), html, { show: true });
}

function clearMessage() {
  return clearContent(getElement(MESSAGE_ID), { hide: true });
}

// ─── HEADER ──────────────────────────────────────────────────────────────────

function renderHeader(title, description = "", badges = []) {
  setText(getElement(TITLE_ID), title);

  renderHeaderPart(
    getElement(DESCRIPTION_ID),
    typeof description === "string"
      ? escapeHtml(description)
      : buildSubtitle(description),
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
  renderPage,
  renderPageError,
  renderHeader,
  renderMessage,
  clearMessage,
};
