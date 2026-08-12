// Page chrome shared by every record view: the wrapper, header, actions and sections.

import { panelGroups, renderDisplayFields, renderGroups } from "../utils/form-fields.js";

const CONTAINER_ID = "container";

// ─── FRAGMENTS ──────────────────────────────────────────────────────────────

function buildTitle() {
  return `
    <div class="page-header side">
      <h1 class="page-title" id="title"></h1>
      <p class="section-description" id="description"></p>
    </div>
  `;
}

function buildAction({ id, label, icon, className = "", hidden = false }) {
  const classes = ["btn", className, "with-icon"].filter(Boolean).join(" ");

  return `
    <a class="${classes}" id="${id}"${hidden ? " hidden" : ""}>
      <i class="btn-icon" data-lucide="${icon}"></i>
      ${label}
    </a>
  `;
}

function buildActions(actions) {
  return `<div class="row right gap-md">${actions.map(buildAction).join("")}</div>`;
}

// The `.row` wrapper only appears alongside actions, matching the pages this replaces.
function buildHeader(actions = []) {
  if (!actions.length) return buildTitle();

  return `
    <div class="row">
      ${buildTitle()}
      ${buildActions(actions)}
    </div>
  `;
}

function buildBackLink({ text, view }) {
  return `<a class="link un" id="back-link" href="#" data-view="${view}">${text}</a>`;
}

function buildSectionLink({ view, linkIcon, linkText }) {
  return `
    <a class="btn with-icon" href="#" data-view="${view}">
      <i class="btn-icon" data-lucide="${linkIcon}"></i>
      ${linkText}
    </a>
  `;
}

// No title, no header row; no view, no link. The stats and body slots are the headerless
// case rather than a shape of their own.
function buildSection({ id, title = "", view, linkIcon, linkText, className = "", create = false }) {
  const header = title
    ? `
      <div class="row">
        <h2 class="section-title">${title}</h2>
        ${view ? buildSectionLink({ view, linkIcon, linkText }) : ""}
      </div>
    `
    : "";

  return `
    <section class="page-section">
      ${header}
      <div${className ? ` class="${className}"` : ""} id="section-${id}"></div>
      ${create ? `<div id="section-${id}-create"></div>` : ""}
    </section>
  `;
}

function buildSections(sections) {
  return sections.map(buildSection).join("");
}

// `className` stays in here rather than being reachable from a domain file — chrome is the
// engine's job.
function buildStats(className = "grid-4") {
  return buildSection({ id: "stats", className });
}

function buildBody() {
  return buildSection({ id: "body" });
}

// Deliberately not a `.page-section` — that carries a 50px bottom margin, which an empty
// slot would spend on every view that never shows a message.
function buildMessage() {
  return `<div id="page-message" hidden></div>`;
}

// ─── PAGE ───────────────────────────────────────────────────────────────────

function buildPage({ back = null, header = "", body = "" }) {
  return `
    ${back ? buildBackLink(back) : ""}
    ${header}
    ${body}
  `;
}

// ─── RENDER ─────────────────────────────────────────────────────────────────

function renderPage(html) {
  const container = document.getElementById(CONTAINER_ID);

  container.replaceChildren();
  container.innerHTML = html;

  return container;
}

function renderHeader(title, description) {
  document.getElementById("title").textContent = title;
  document.getElementById("description").textContent = description;
}

function renderDetails(model, fields, recordPanels) {
  sectionBody("body").innerHTML = renderGroups(
    panelGroups(fields, recordPanels),
    model,
    fields,
    renderDisplayFields,
  );
}

function sectionBody(id) {
  return document.getElementById(`section-${id}`);
}

function sectionCreate(id) {
  return document.getElementById(`section-${id}-create`);
}

function pageMessage() {
  return document.getElementById("page-message");
}


export {
  buildHeader,
  buildStats,
  buildSection,
  buildSections,
  buildBody,
  buildMessage,
  buildPage,
  renderPage,
  renderDetails,
  renderHeader,
  sectionBody,
  sectionCreate,
  pageMessage,
};
