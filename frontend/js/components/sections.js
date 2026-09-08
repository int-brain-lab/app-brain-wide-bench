// Shared page layout:
//
//   page header
//   page message
//   sections
//
// Sections have stable ids so views can render into them without owning the surrounding
// page markup.

import { resolveContainer } from "../core/dom.js";
import { escapeHtml } from "../core/html.js";
import { getElement } from "../core/render.js";
import { getIcon } from "./icons.js";

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
    ? `<span class="row left gap-lg">${items}</span>`
    : "";
}

function buildTitleBadges(badges = []) {
  const items = badges.filter(Boolean);

  return items.length
    ? `<span class="row left gap-lg">${items.join("")}</span>`
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
    <span class="column gap-lg">
      ${actions
        .map((action) =>
          buildActionRow(Array.isArray(action) ? action : [action]),
        )
        .join("")}
    </span>
  `;
}

// ─── PAGE ────────────────────────────────────────────────────────────────────

function buildPage({
  header = "",
  body = "",
}) {
  return `
    ${header}
    <div id="${MESSAGE_ID}" hidden></div>
    ${body}
  `;
}

// ─── SECTIONS ────────────────────────────────────────────────────────────────

// The section a title turns off and on, by id.
const COLLAPSE = "collapse";

/**
 * @param controls    markup to sit beside the heading rather than out at the end of the row —
 *                    for a control the title reads into ("Ranked over" and the suites it is
 *                    ranked over), where the gap of an action row would break the sentence.
 *                    `actions` is still the far end of the same row.
 * @param collapsible the title turns the body off and on. Needs attachCollapse on an
 *                    ancestor, once — the arrow is markup and the listener is not.
 * @param compact     the smaller heading a panel inside a page takes, rather than a page
 *                    section's own.
 * @param hideTitle   keep the heading's space but not its text, for a section sharing a row
 *                    with others whose headings are what start their bodies at one height.
 * @param collapsed   folded to start with, for a section a reader asks for rather than reads.
 */
function buildSection({
  id,
  title = "",
  description = "",
  controls = "",
  actions = [],
  className = "",
  hidden = false,
  collapsible = false,
  collapsed = false,
  compact = false,
  hideTitle = false,
}) {
  // `visibility`, not `display`: the heading still takes the height it would have, which is
  // the whole of what a hidden one is for. Named apart from the `hidden` above, which is the
  // section's own.
  const titleClass = hideTitle ? " invisible" : "";

  // A panel's heading is a span at card size; a page section's is its own h2.
  const titleHtml = compact
    ? `<span class="card-title${titleClass}">${escapeHtml(title)}</span>`
    : `<h2 class="section-title${titleClass}">${escapeHtml(title)}</h2>`;
  const heading = !title
    ? ""
    : collapsible
      ? `
      <button
        type="button"
        class="section-toggle row left gap-sm"
        data-${COLLAPSE}="${escapeHtml(id)}"
        aria-expanded="${!collapsed}"
      >
        ${titleHtml}
        <i class="field-icon" data-lucide="${escapeHtml(getIcon("down"))}"></i>
      </button>
    `
      : titleHtml;

  // Controls or actions alone for a section headed by something else, or by nothing but the
  // buttons that work it. `right` where there is nothing on the left, since a row of one
  // otherwise puts its only child at the near end.
  const header = title || controls || actions.length
    ? `
    <div class="column gap-xs">
      <div class="row${heading || controls ? "" : " right"}">
        ${controls ? `<div class="row left gap-xl section-lead">${heading}${controls}</div>` : heading}
        ${actions.length ? buildActions(actions) : ""}
      </div>
      ${
        description
          ? `<div class="${compact ? "metadata bold" : "section-description"}">${escapeHtml(description)}</div>`
          : ""
      }
     </div>  
    `
    : "";

  const classes = ["section-body", className]
    .filter(Boolean)
    .join(" ");

  return `
    <section
      class="page-section${collapsed ? " collapsed" : ""}"
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

/**
 * A section's trailing control — the way to the rest of what the section is previewing,
 * under the last card or the last row rather than up beside the heading, so a reader meets
 * it having read what it offers more of.
 *
 * @param action the markup, from buildViewAllButton or the like. Falsy for no footer, which
 *               is what a section with nothing to show yet wants.
 * @param hidden the space the footer takes and nothing else — for a section sharing a row
 *               with ones that have a button, whose card fills the height theirs give up to
 *               their footers and so would end lower than theirs. `visibility`, so the row
 *               is the button's own height rather than a guess at it, and `inert` besides:
 *               it is spacing, and nothing in it is there to be pressed or read out.
 *
 * @returns the markup, to follow the section's own content in its body.
 */
function buildSectionFooter(action, { hidden = false } = {}) {
  if (!action) return "";

  return hidden
    ? `<div class="section-footer row right invisible" inert aria-hidden="true">${action}</div>`
    : `<div class="section-footer row right">${action}</div>`;
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

// ─── COLLAPSING ──────────────────────────────────────────────────────────────

/**
 * Let every collapsible title under `container` turn its own section off and on.
 *
 * Delegated and attached once: a section's body is written and rewritten by whoever owns it,
 * and the state lives on the section itself, so what is collapsed survives a redraw.
 *
 * @param container element, or the id of one, holding the sections.
 */
function attachCollapse(container) {
  resolveContainer(container).addEventListener("click", (event) => {
    // `closest`, not the target: the click lands on the arrow or the title inside the button.
    const toggle = event.target?.closest?.(`[data-${COLLAPSE}]`);

    if (!toggle) return;

    const section = getSection(toggle.dataset[COLLAPSE]);

    if (!section) return;

    const collapsed = section.classList.toggle("collapsed");

    toggle.setAttribute("aria-expanded", String(!collapsed));
  });
}

// ─── DOM ACCESS ──────────────────────────────────────────────────────────────

function getSection(id) {
  return getElement(`section-${id}`);
}

function getSectionBody(id) {
  return getElement(`section-${id}-body`);
}

export {
  attachCollapse,
  buildHeader,
  buildSubtitle,
  buildTitleBadges,
  buildPage,
  buildActions,
  buildSection,
  buildSectionFooter,
  buildRow,
  buildSections,
  getSection,
  getSectionBody,
};