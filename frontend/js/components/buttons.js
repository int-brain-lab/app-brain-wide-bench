import {getIcon} from "./icons.js";
import {escapeHtml} from "../core/html.js";



export const COMPARE_BUTTON_ID = "compare-button";
export const CREATE_BUTTON_ID = "create-button";
export const EDIT_BUTTON_ID = "edit-button";
export const CANCEL_BUTTON_ID = "cancel-button";
export const SAVE_BUTTON_ID = "save-button";
export const MEMBERS_BUTTON_ID = "members-button";
export const SUBMIT_BUTTON_ID = "submit-button";

export const TABLE_TOGGLE_ID = "table-toggle";
export const CARD_TOGGLE_ID = "card-toggle";

export const TABLE_VIEW = "table-view"
export const PLOT_VIEW = "plot-view"


/**
 * @param id     omit for a button nothing looks up by id.
 * @param label  the text.
 * @param icon   a lucide name — see components/icons.js.
 * @param href   where it goes. Without one it is a `<button>`.
 * @param view   a view of the page it is already on: the router picks it up by data-view
 *               and switches in place — see core/router.js.
 * @param className  extra classes beside `btn with-icon`.
 * @param hidden start hidden, for a control another one reveals.
 * @param disabled start disabled, for one something else has to enable.
 * @returns the markup.
 */
export function buildButton({
  id = null,
  label,
  icon,
  href = null,
  view = null,
  className = "",
  hidden = false,
  disabled = false,
}) {
  const classes = ["btn", className, "with-icon"].filter(Boolean).join(" ");

  const attributes = [
    `class="${classes}"`,
    id ? `id="${escapeHtml(id)}"` : "",
    hidden ? "hidden" : "",
    disabled ? "disabled" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const body = `
    <i class="btn-icon" data-lucide="${escapeHtml(icon)}"></i>
    ${escapeHtml(label)}
  `;

  if (view) {
    return `<a ${attributes} href="#" data-view="${escapeHtml(view)}">${body}</a>`;
  }

  if (href) {
    return `<a ${attributes} href="${escapeHtml(href)}">${body}</a>`;
  }

  return `<button type="button" ${attributes}>${body}</button>`;
}



export function buildCompareButton(
  { id = COMPARE_BUTTON_ID, href=null, label = "Compare", className = "" } = {}
) {
  return buildButton({
    id,
    label,
    href,
    className,
    icon: getIcon("compare"),
  });
}

export function buildCreateButton(
  { id = CREATE_BUTTON_ID, href=null, label = "New" } = {}
) {
  return buildButton({
    id,
    label,
    href,
    icon: getIcon("create"),
    className: "primary-inv",
  });
}


export function buildEditButton(
  { id = EDIT_BUTTON_ID, href=null, label = "Edit" } = {}
) {
  return buildButton({
    id,
    label,
    href,
    icon: getIcon("edit"),
  });
}


export function buildCancelButton(
  { id = CANCEL_BUTTON_ID, href=null, label = "Cancel", hidden = false } = {}
) {
  return buildButton({
    id,
    label,
    href,
    hidden,
    icon: getIcon("cancel"),
  });
}



export function buildSaveButton(
  { id = SAVE_BUTTON_ID, href=null, label = "Save", hidden = false } = {}
) {
  return buildButton({
    id,
    label,
    href,
    hidden,
    icon: getIcon("save"),
    className: "primary",
  });
}


export function buildMembersButton(
  { id = MEMBERS_BUTTON_ID, href=null, view=null, label = "Manage members" } = {}
) {
  return buildButton({
    id,
    label,
    href,
    view,
    icon: getIcon("team"),
  });
}

// Save and Cancel start hidden: a record view opens read-only, and the editor swaps which
// of the three show.
export const EDIT_BUTTONS = [
  buildEditButton(),
  buildCancelButton({ hidden: true }),
  buildSaveButton({ hidden: true }),
];

/**
 * The buttons that switch one thing between ways of reading it. Which is lit says which way
 * is open, so the caller attaches a listener per id and thereafter only sets the class — see
 * setActiveView in comparisons/modelComparison.js.
 *
 * @param buttons [{ id, label, icon }] — `icon` is an app name, resolved here, so a caller
 *                names the thing rather than the glyph. See components/icons.js.
 * @returns the markup.
 */
export function buildToggle(buttons) {
  return `
    <div class="row right gap-sm">
      ${buttons
        .map(({ id, label, icon }) =>
          buildButton({ id, label, icon: getIcon(icon) }),
        )
        .join("")}
    </div>
  `;
}

// The two the app switches between, each owning its ids so a listener and a button cannot
// disagree about them.
const CARD_TABLE_BUTTONS = [
  { id: CARD_TOGGLE_ID, label: "Cards", icon: "cards" },
  { id: TABLE_TOGGLE_ID, label: "Table", icon: "table" },
];

const PLOT_TABLE_BUTTONS = [
  { id: PLOT_VIEW, label: "Plots", icon: "score" },
  { id: TABLE_VIEW, label: "Table", icon: "table" },
];

export function buildCardTableToggle() {
  return buildToggle(CARD_TABLE_BUTTONS);
}

export function buildPlotTableToggle() {
  return buildToggle(PLOT_TABLE_BUTTONS);
}



// A create page's footer: Cancel back to where it came from, and the submit button, which
// starts disabled — the form enables it once every panel is complete.
export function buildFormFooter({ cancelHref, submitLabel }) {
  return `
    <div class="row right gap-md">
      ${buildCancelButton({ id: null, href: cancelHref })}
      ${buildButton({
        id: SUBMIT_BUTTON_ID,
        label: submitLabel,
        icon: getIcon("create"),
        className: "primary",
        disabled: true,
      })}
    </div>
  `;
}
