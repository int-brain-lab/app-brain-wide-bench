// Page chrome shared by every record view: the wrapper, header, actions and sections.

import {
  panelGroups,
  renderDisplayFields,
  renderGroups,
} from "../utils/form-fields.js";

const CONTAINER_ID = "container";
const TITLE_ID = "title";
const DESCRIPTION_ID = "description";
const MESSAGE_ID = "page-message";
const SUBMIT_ID = "submit-button";

// ─── BUILDERS ────────────────────────────────────────────────────────────────

function buildTitle() {
  return `
    <div class="page-header side">
      <h1 class="page-title" id="${TITLE_ID}"></h1>
      <p class="section-description" id="${DESCRIPTION_ID}"></p>
    </div>
  `;
}

function buildAction(action) {
  if (action.html) {
    return action.html;
  }

  const {
    id,
    label,
    icon,
    className = "",
    hidden = false,
  } = action;

  const classes = ["btn", className, "with-icon"]
    .filter(Boolean)
    .join(" ");

  return `
    <a class="${classes}" id="${id}"${hidden ? " hidden" : ""}>
      <i class="btn-icon" data-lucide="${icon}"></i>
      ${label}
    </a>
  `;
}

function buildActions(actions) {
  const markup = actions
    .map(buildAction)
    .join("");

  return `<div class="row right gap-md">${markup}</div>`;
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

function buildBackLink({ text, view }) {
  return `
    <a
      class="link un"
      id="back-link"
      href="#"
      data-view="${view}"
    >
      ${text}
    </a>
  `;
}

function buildSectionLink({
  view,
  linkIcon,
  linkText,
}) {
  return `
    <a
      class="btn with-icon"
      href="#"
      data-view="${view}"
    >
      <i class="btn-icon" data-lucide="${linkIcon}"></i>
      ${linkText}
    </a>
  `;
}

function buildLink({
  href,
  label,
  icon,
  className = "",
}) {
  const classes = ["btn", className, "with-icon"]
    .filter(Boolean)
    .join(" ");

  return `
    <a class="${classes}" href="${href}">
      <i class="btn-icon" data-lucide="${icon}"></i>
      ${label}
    </a>
  `;
}

function buildSection({
  id,
  title = "",
  view,
  linkIcon,
  linkText,
  links = [],
  className = "",
  create = false,
}) {
  const actions = [
    ...(view
      ? [buildSectionLink({ view, linkIcon, linkText })]
      : []),
    ...links.map(buildLink),
  ];

  const buttons =
    actions.length > 1
      ? `<div class="row right gap-md">${actions.join("")}</div>`
      : actions.join("");

  const header = title
    ? `
      <div class="row">
        <h2 class="section-title">${title}</h2>
        ${buttons}
      </div>
    `
    : "";

  const createRow = create
    ? `<div id="section-${id}-create"></div>`
    : "";

  const classAttribute = className
    ? ` class="${className}"`
    : "";

  return `
    <section class="page-section">
      ${header}
      <div${classAttribute} id="section-${id}"></div>
      ${createRow}
    </section>
  `;
}

function buildSections(sections) {
  return sections.map(buildSection).join("");
}

function buildStats(className = "grid-4") {
  return buildSection({
    id: "stats",
    className,
  });
}

function buildBody() {
  return buildSection({
    id: "body",
  });
}

// Deliberately not a `.page-section` — an empty message shouldn't introduce
// the section spacing used by normal content sections.
function buildMessage() {
  return `<div id="${MESSAGE_ID}" hidden></div>`;
}

// Cancel beside the primary button, identical on every create form. The caller wraps this,
// the panels and the message in one `.column.gap-lg` — that wrapper is what spaces the
// button off the last panel, and it puts the message directly above the control that
// produced it.
function buildFormFooter({ cancelHref, submitLabel }) {
  return `
    <div class="row right gap-md">
      <a class="btn with-icon" href="${cancelHref}">
        <i class="btn-icon" data-lucide="x"></i>
        Cancel
      </a>
      <button type="button" class="btn primary with-icon" id="${SUBMIT_ID}" disabled>
        <i class="btn-icon" data-lucide="plus"></i>
        ${submitLabel}
      </button>
    </div>
  `;
}

function buildPage({
  back = null,
  header = "",
  body = "",
}) {
  return `
    ${back ? buildBackLink(back) : ""}
    ${header}
    ${body}
  `;
}

// ─── RENDERING ───────────────────────────────────────────────────────────────

function renderPage(html) {
  const container = document.getElementById(CONTAINER_ID);

  container.replaceChildren();
  container.innerHTML = html;

  return container;
}

function renderHeader(title, description = "") {
  const titleElement = document.getElementById(TITLE_ID);
  const descriptionElement = document.getElementById(
    DESCRIPTION_ID,
  );

  titleElement.textContent = title;
  descriptionElement.textContent = description;
  descriptionElement.hidden = !description;
}

function renderDetails(model, fields, recordPanels) {
  sectionBody("body").innerHTML = renderGroups(
    panelGroups(fields, recordPanels),
    model,
    fields,
    renderDisplayFields,
  );
}

// ─── DOM ACCESS ──────────────────────────────────────────────────────────────

function sectionBody(id) {
  return document.getElementById(`section-${id}`);
}

function sectionCreate(id) {
  return document.getElementById(`section-${id}-create`);
}

function pageMessage() {
  return document.getElementById(MESSAGE_ID);
}

function submitButton() {
  return document.getElementById(SUBMIT_ID);
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

export {
  buildHeader,
  buildStats,
  buildSection,
  buildSections,
  buildBody,
  buildMessage,
  buildFormFooter,
  buildPage,
  renderPage,
  renderDetails,
  renderHeader,
  sectionBody,
  sectionCreate,
  pageMessage,
  submitButton,
};