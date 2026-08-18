// Page chrome shared by every record view: the wrapper, header, actions and sections.

import { renderMessage } from "../core/utils.js";
import { panelGroups } from "../schemas/schema.js";
import { buildDisplayFields, buildGroupCards } from "../forms/fields.js";

const CONTAINER_ID = "container";
const TITLE_ID = "title";
const DESCRIPTION_ID = "description";
const MESSAGE_ID = "page-message";
const SUBMIT_ID = "submit-button";
const EDIT_ID = "edit-button";
const SAVE_ID = "save-button";
const CANCEL_ID = "cancel-button";

// The Edit / Save / Cancel trio, in the order they sit in the header. Save and Cancel start
// hidden because a record view opens read-only; the editor swaps which of the three show.
//
// Declared once here rather than per view: they were five identical copies, and the ids are
// a contract with record-editor.js, which finds the buttons by them. A view that offers no
// editing passes `[]` to buildHeader instead — see teamView, where a non-member gets none.
//
// All three are exported individually as well as as the trio, because two views need less
// or more than exactly this list: a dashboard offers Edit alone as a way *into* the details
// view (nothing there to save), and the task view slots its apply-to-suite control between
// Edit and Save. What was worth sharing is the definitions, not the composition.
const EDIT_ACTION = {
  id: EDIT_ID,
  label: "Edit",
  icon: "pencil",
};

const SAVE_ACTION = {
  id: SAVE_ID,
  label: "Save",
  icon: "check",
  className: "primary",
  hidden: true,
};

const CANCEL_ACTION = {
  id: CANCEL_ID,
  label: "Cancel",
  icon: "x",
  hidden: true,
};

const EDIT_ACTIONS = [EDIT_ACTION, SAVE_ACTION, CANCEL_ACTION];

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
// Cancel beside the primary button, identical on every create form. The caller wraps this
// and the panels in one `.column.gap-lg`, which is what spaces the button off the last
// panel; buildPage puts the message region below the pair.
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

// Every page gets its message region here rather than composing it per view: a view that
// forgot it left `pageMessage()` null, and the first report of a failed save threw instead
// of showing.
//
// Under the header, above the body. Everything that writes here is the outcome of something
// the user just did — a save, a create — and a form or a record long enough to scroll would
// hide it anywhere lower. A view reporting something about one section writes to that
// section instead, not here.
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
  sectionBody("body").innerHTML = buildGroupCards(
    panelGroups(fields, recordPanels),
    model,
    fields,
    buildDisplayFields,
  );
}

// ─── DOM ACCESS ──────────────────────────────────────────────────────────────

// The "make your first submission / register your first model" card a create flow leaves
// behind. True only until the user does something else, so any editor action removes it.
const POST_CREATE_SECTION = "post-create";

function clearPostCreate() {
  sectionBody(POST_CREATE_SECTION)?.closest("section")?.remove();
}

function sectionBody(id) {
  return document.getElementById(`section-${id}`);
}

function sectionCreate(id) {
  return document.getElementById(`section-${id}-create`);
}

function pageMessage() {
  return document.getElementById(MESSAGE_ID);
}

function pageContainer() {
  return document.getElementById(CONTAINER_ID);
}

// The one way to report a page that failed before it could render. The error replaces the
// container, so nothing half-built is left behind it — and going through here rather than
// each loader finding #container for itself is what keeps a failure looking the same
// wherever it happened.
//
// Not for a failure *after* the page is up: that one has a page to sit in, and belongs in
// the message region or the section whose content is missing.
function showPageError(message, error) {
  renderMessage(pageContainer(), message, "page-error", error?.message ?? "");
}

function submitButton() {
  return document.getElementById(SUBMIT_ID);
}

// Resolved on demand, not held: a view re-renders its whole header, so the elements from the
// last render are detached by the time the next editor is attached.
function editButtons() {
  return {
    editButton: document.getElementById(EDIT_ID),
    saveButton: document.getElementById(SAVE_ID),
    cancelButton: document.getElementById(CANCEL_ID),
  };
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

export {
  CANCEL_ACTION,
  POST_CREATE_SECTION,
  clearPostCreate,
  EDIT_ACTION,
  EDIT_ACTIONS,
  SAVE_ACTION,
  buildHeader,
  editButtons,
  buildStats,
  buildSection,
  buildSections,
  buildBody,
  buildFormFooter,
  buildPage,
  renderPage,
  showPageError,
  renderDetails,
  renderHeader,
  sectionBody,
  sectionCreate,
  pageContainer,
  pageMessage,
  submitButton,
};