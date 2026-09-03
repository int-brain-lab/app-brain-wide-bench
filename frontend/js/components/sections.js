// Shared page layout:
//
//   back link
//   page header
//   page message
//   sections
//
// Sections have stable ids so views can render into them without owning the surrounding
// page markup.

import { escapeHtml } from "../core/html.js";
import { getElement } from "../core/render.js";

export const TITLE_ID = "title";
export const DESCRIPTION_ID = "description";
export const BADGES_ID = "badges";
export const MESSAGE_ID = "page-message";

// ─── HEADER ──────────────────────────────────────────────────────────────────

function buildTitle() {
  return `
    <div class="page-header side">
      <h1 class="page-title" id="${TITLE_ID}"></h1>
      <p class="section-description" id="${DESCRIPTION_ID}"></p>
      <span class="row left gap-xs" id="${BADGES_ID}" hidden></span>
    </div>
  `;
}

function buildHeader(actions = []) {
  if (!actions.length) {
    return buildTitle();
  }

  return `
    <div class="row">
      ${buildTitle()}
      ${buildActions(actions)}
    </div>
  `;
}

function buildSubtitle(subtitles = []) {
  const items = subtitles
    .filter((part) => part?.text)
    .map(
      ({ text, icon }) => `
        <span class="row left gap-sm">
          ${
            icon
              ? `<i class="field-icon" data-lucide="${escapeHtml(icon)}"></i>`
              : ""
          }
          <span>${escapeHtml(text)}</span>
        </span>
      `,
    )
    .join("<span>·</span>");

  return items
    ? `<span class="row left gap-md">${items}</span>`
    : "";
}

function buildTitleBadges(badges = []) {
  const items = badges.filter(Boolean);

  return items.length
    ? `<span class="row left gap-md">${items.join("")}</span>`
    : "";
}

// ─── ACTIONS ─────────────────────────────────────────────────────────────────

function buildActionRow(actions) {
  return `<div class="row right gap-md">${actions.join("")}</div>`;
}

function buildActions(actions = []) {
  if (!actions.some(Array.isArray)) {
    return buildActionRow(actions);
  }

  return `
    <span class="column gap-md">
      ${actions
        .map((action) =>
          buildActionRow(Array.isArray(action) ? action : [action]),
        )
        .join("")}
    </span>
  `;
}

// ─── NAVIGATION ──────────────────────────────────────────────────────────────

function buildBackLink({ text, view, href }) {
  const target = view
    ? `href="#" data-view="${escapeHtml(view)}"`
    : `href="${escapeHtml(href)}"`;

  return `
    <a class="link un" id="back-link" ${target}>
      ${escapeHtml(text)}
    </a>
  `;
}

// ─── PAGE ────────────────────────────────────────────────────────────────────

function buildPage({
  back = null,
  header = "",
  body = "",
}) {
  return `
    ${back ? buildBackLink(back) : ""}
    ${header}
    <div id="${MESSAGE_ID}" hidden></div>
    ${body}
  `;
}

// ─── SECTIONS ────────────────────────────────────────────────────────────────

/**
 * @param controls markup to sit beside the heading rather than out at the end of the row —
 *                 for a control the title reads into ("Ranked over" and the suites it is
 *                 ranked over), where the gap of an action row would break the sentence.
 *                 `actions` is still the far end of the same row.
 */
function buildSection({
  id,
  title = "",
  controls = "",
  actions = [],
  className = "",
  hidden = false,
}) {
  const heading = `<h2 class="section-title">${escapeHtml(title)}</h2>`;

  const header = title
    ? `
      <div class="row">
        ${controls ? `<div class="row left gap-lg">${heading}${controls}</div>` : heading}
        ${actions.length ? buildActions(actions) : ""}
      </div>
    `
    : "";

  const classes = ["section-body", className]
    .filter(Boolean)
    .join(" ");

  return `
    <section
      class="page-section"
      id="section-${escapeHtml(id)}"
      ${hidden ? "hidden" : ""}
    >
      ${header}
      <div
        class="${classes}"
        id="section-${escapeHtml(id)}-body"
      ></div>
    </section>
  `;
}

function buildRow({
  sections,
  ratio = "",
  stretch = true,
}) {
  const classes = [
    "section-row",
    ratio && `ratio-${ratio}`,
    !stretch && "align-start",
  ]
    .filter(Boolean)
    .join(" ");

  return `
    <div class="${classes}">
      ${buildSections(sections)}
    </div>
  `;
}

/**
 * @param sections  section descriptors in page order.
 *
 * A normal section:
 *
 *   { id, title, actions, ... }
 *
 * A row:
 *
 *   { sections: [section, section], uneven, stretch }
 *
 * Rows do not nest.
 */
function buildSections(sections = []) {
  return sections
    .map((entry) =>
      entry.sections
        ? buildRow(entry)
        : buildSection(entry),
    )
    .join("");
}

// ─── DOM ACCESS ──────────────────────────────────────────────────────────────

function getSection(id) {
  return getElement(`section-${id}`);
}

function getSectionBody(id) {
  return getElement(`section-${id}-body`);
}

export {
  buildHeader,
  buildSubtitle,
  buildTitleBadges,
  buildBackLink,
  buildPage,
  buildActions,
  buildSection,
  buildRow,
  buildSections,
  getSection,
  getSectionBody,
};