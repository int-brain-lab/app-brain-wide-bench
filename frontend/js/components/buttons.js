import { getIcon } from "./icons.js";
import { escapeHtml } from "../core/html.js";
import { buildCount } from "./count.js";
import { pluralise } from "../core/utils.js";

export const COMPARE_BUTTON_ID = "compare-button";
export const GO_BUTTON_ID = "go-to-comparison";
export const CREATE_BUTTON_ID = "create-button";
export const EDIT_BUTTON_ID = "edit-button";
export const CANCEL_BUTTON_ID = "cancel-button";
export const SAVE_BUTTON_ID = "save-button";
export const DELETE_BUTTON_ID = "delete-button";
export const MEMBERS_BUTTON_ID = "members-button";
export const SUBMIT_BUTTON_ID = "submit-button";

export const TABLE_TOGGLE_ID = "table-toggle";
export const CARD_TOGGLE_ID = "card-toggle";

export const TABLE_VIEW = "table-view";
export const PLOT_VIEW = "plot-view";

// Read out by the hint beside them as well as worn by the buttons: a renamed button would
// otherwise leave the sentence naming one that is not there. The leaderboard and the lists
// both have this pair — see updateComparing in pages/leaderboard.js and updateCompare in
// templates/listView.js.
export const DONE_LABEL = "Done";
export const GO_COMPARE_LABEL = "Go to comparison";

function buttonBody({ label, icon }) {
  return `
    <i class="btn-icon" data-lucide="${escapeHtml(icon)}"></i>
    ${escapeHtml(label)}
  `;
}

/**
 * Relabel a button already on the page — for one that says which way it will go next, like
 * "Show more filters" becoming "Show fewer".
 *
 * The whole body rather than the text, because the icon turns with the label; and the caller
 * refreshes lucide, since the fresh placeholder is usually not the only one it has just
 * written.
 */
export function setButtonLabel(button, { label, icon }) {
  if (button) button.innerHTML = buttonBody({ label, icon });
}

/**
 * @param id     omit for a button nothing looks up by id.
 * @param label  the text.
 * @param icon   a lucide name — see components/icons.js.
 * @param href   where it goes. Without one it is a `<button>`.
 * @param view   a view of the page it is already on: the router picks it up by data-view
 *               and switches in place — see core/router.js.
 * @param data   extra data attributes — `{ "user-id": id }` becomes `data-user-id`. For a
 *               button a delegated listener reads its subject off.
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
  data = {},
  className = "",
  hidden = false,
  disabled = false,
}) {
  // A link is not a form control: `disabled` on an <a> is ignored by the browser and by
  // `.btn:disabled`, so the state is a class the stylesheet takes the pointer off — see
  // `.btn.disabled-link` in style.css.
  const link = Boolean(view || href);

  const classes = ["btn", className, "with-icon", link && disabled ? "disabled-link" : ""]
    .filter(Boolean)
    .join(" ");

  const attributes = [
    `class="${classes}"`,
    id ? `id="${escapeHtml(id)}"` : "",
    hidden ? "hidden" : "",
    disabled ? (link ? `aria-disabled="true" tabindex="-1"` : "disabled") : "",
    ...Object.entries(data).map(([key, value]) => `data-${key}="${escapeHtml(String(value))}"`),
  ]
    .filter(Boolean)
    .join(" ");

  const body = buttonBody({ label, icon });

  if (view) {
    return `<a ${attributes} href="#" data-view="${escapeHtml(view)}">${body}</a>`;
  }

  if (href) {
    return `<a ${attributes} href="${escapeHtml(href)}">${body}</a>`;
  }

  return `<button type="button" ${attributes}>${body}</button>`;
}

// The way in and the way out, wherever they are offered: the nav, a private page's gate, and
// the card a page shows a signed-out reader in place of its content.
export function buildSignInButton({ id = null, data = {}, label = "Sign in" } = {}) {
  return buildButton({ id, label, data, icon: getIcon("signIn"), className: "primary" });
}

// Plain, where Sign in is filled: signing out is a way off the page rather than the thing the
// page is for.
export function buildSignOutButton({ id = null, data = {}, label = "Sign out" } = {}) {
  return buildButton({ id, label, data, icon: getIcon("signOut") });
}

// For a reader who has no account yet. It goes exactly where Sign in goes — the same hosted
// page carries both — so the card can offer the two without a second flow behind them.
export function buildSignUpButton({ id = null, data = {}, label = "Create an account" } = {}) {
  return buildButton({ id, label, data, icon: getIcon("add") });
}

export function buildCompareButton({
  id = COMPARE_BUTTON_ID,
  href = null,
  label = "Compare",
  className = "",
  disabled = false,
} = {}) {
  return buildButton({
    id,
    label,
    href,
    className,
    disabled,
    icon: getIcon("compare"),
  });
}

// Filled: making a new thing is what a list page is for, and the one thing a note saying you
// have none offers. `className` is still the caller's, for a create button that should read
// with the ones beside it rather than lead them — "" leaves `.btn`'s own fill.
export function buildCreateButton({
  id = CREATE_BUTTON_ID,
  href = null,
  label = "New",
  className = "primary",
} = {}) {
  return buildButton({
    id,
    label,
    href,
    icon: getIcon("create"),
    className,
  });
}

export function buildEditButton({ id = EDIT_BUTTON_ID, href = null, label = "Edit" } = {}) {
  return buildButton({
    id,
    label,
    href,
    icon: getIcon("edit"),
  });
}

// Red wherever it appears: both the one that opens the confirmation and the one inside it
// that carries it out. `id` is the caller's, since the card holds a second of these.
export function buildDeleteButton({
  id = DELETE_BUTTON_ID,
  label = "Delete",
  disabled = false,
} = {}) {
  return buildButton({
    id,
    label,
    disabled,
    icon: getIcon("delete"),
    className: "danger",
  });
}

export function buildCancelButton({
  id = CANCEL_BUTTON_ID,
  href = null,
  label = "Cancel",
  hidden = false,
} = {}) {
  return buildButton({
    id,
    label,
    href,
    hidden,
    icon: getIcon("cancel"),
  });
}

export function buildSaveButton({
  id = SAVE_BUTTON_ID,
  href = null,
  label = "Save",
  hidden = false,
} = {}) {
  return buildButton({
    id,
    label,
    href,
    hidden,
    icon: getIcon("save"),
    className: "primary",
  });
}

/**
 * The way from a section's preview to the whole of it, under the section's content.
 *
 * @param noun    *singular* — "model". Pluralised for the label.
 * @param viewAll `{ view }` for a view of the same page, or `{ href }` to leave it. Omit
 *                for no button — a section showing everything it has needs none.
 * @param count   how many are behind it — "View all 12 submissions". Omit where the number
 *                isn't known, which leaves the plain "View all submissions".
 *
 * @returns the markup.
 */
export function buildViewAllButton(noun, viewAll, { count = null } = {}) {
  if (!viewAll) return "";

  return buildButton({
    label: `View all ${count == null ? pluralise(noun) : buildCount(count, noun)}`,
    icon: getIcon("viewAll"),
    href: viewAll.href ?? null,
    view: viewAll.view ?? null,
    className: "sm",
  });
}

// The record's own fields, from a section showing something else about it — "all details"
// would promise a longer version of what is on screen, which is not what it opens.
//
// `sm` for the section footer it usually closes; pass "" for a page header, where it sits
// beside buttons of the header's own size.
export function buildDetailsButton({
  href = null,
  view = null,
  label = "View details",
  className = "sm",
} = {}) {
  return buildButton({
    label,
    icon: getIcon("details"),
    href,
    view,
    className,
  });
}

// The same trip, named for why someone who may change the record makes it. It opens the
// details view and stops there: the Edit button on that view is what starts the editor.
export const EDIT_DETAILS_BUTTON = buildDetailsButton({
  view: "details",
  label: "Edit details",
  className: "",
});

export function buildMembersButton({
  id = MEMBERS_BUTTON_ID,
  href = null,
  view = null,
  label = "Manage members",
} = {}) {
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
 * setActiveView in comparisons/recordComparison.js.
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
          buildButton({ id, label, icon: getIcon(icon), className: "sm" }),
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

/**
 * @param scope suffixed onto both ids, for a caller mounting more than one of these. An id
 *              has to be unique on the page, and two copies of one control is exactly what a
 *              comparison with a toggle over each of its panels has — both standing for the
 *              same choice, so whoever mounts them lights every copy. See setActiveView in
 *              comparisons/recordComparison.js. Omit for a page with one.
 */
export function buildPlotTableToggle(scope = "") {
  return buildToggle(
    PLOT_TABLE_BUTTONS.map((button) => ({
      ...button,
      id: scope ? `${button.id}-${scope}` : button.id,
    })),
  );
}

// A create page's footer: Cancel back to where it came from, and the submit button, which
// starts disabled — the form enables it once every panel is complete.
export function buildFormFooter({ cancelHref, submitLabel }) {
  return `
    <div class="row right gap-lg">
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
