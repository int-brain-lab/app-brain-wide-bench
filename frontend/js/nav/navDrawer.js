// The navigation drawer: the state behind whichever nav the shell carries.
//
// Below the chrome breakpoint the top nav's links and the sidebar's rail are the same thing —
// an off-canvas panel — so this owns only what is not layout: the button, the backdrop,
// Escape, and closing on the way out. Which of the two slides is style.css's, scoped to the
// shell, so neither nav module has to know it has become a drawer.

import { CHROME_QUERY, PHONE_QUERY } from "../core/breakpoints.js";
import { getIcon } from "../components/icons.js";
import { getElement } from "../core/render.js";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const TOGGLE_ID = "nav-toggle";
const BACKDROP_ID = "nav-backdrop";

// On <body>, so both panels and the backdrop answer to one class.
const OPEN_CLASS = "drawer-open";

// Every link either panel holds, which is every way out of the page a panel offers.
const PANEL_LINK = ".nav-links a, .sidebar a";

// The account controls, which the bar hands to the panel's foot on a phone — see the query
// of the same width in style.css.
const ACCOUNT_ID = "nav-account";

// ─── MARKUP ──────────────────────────────────────────────────────────────────

/**
 * The button that opens the drawer, for the bar to place among its own controls.
 *
 * No `aria-controls`: which panel it opens is the shell's to decide, and naming the wrong
 * one reads worse than naming none.
 *
 * @returns the markup.
 */
function buildNavToggle() {
  return `
    <button
      class="nav-toggle"
      id="${TOGGLE_ID}"
      type="button"
      aria-label="Menu"
      aria-expanded="false"
    >
      <i class="nav-toggle-icon" data-lucide="${getIcon("menu")}"></i>
    </button>
  `;
}

// ─── STATE ───────────────────────────────────────────────────────────────────

function isDrawerOpen() {
  return document.body.classList.contains(OPEN_CLASS);
}

// `getClientRects`, not `offsetParent`, which is null for a fixed element however visible
// it is — and the panel is fixed.
function isVisible(element) {
  return Boolean(element?.getClientRects().length);
}

// The first destination in whichever panel the shell is showing.
function focusPanel() {
  for (const link of document.querySelectorAll(PANEL_LINK)) {
    if (isVisible(link)) {
      link.focus();
      return;
    }
  }
}

function setDrawerOpen(open) {
  document.body.classList.toggle(OPEN_CLASS, open);

  const toggle = getElement(TOGGLE_ID);

  toggle?.setAttribute("aria-expanded", String(open));

  if (open) {
    focusPanel();
    return;
  }

  // Back to the button that opened it — but only while there still is one: a resize past the
  // breakpoint closes the drawer and takes the button with it.
  if (isVisible(toggle)) {
    toggle.focus();
  }
}

// ─── ACCOUNT ─────────────────────────────────────────────────────────────────

// The panel this shell is showing: the rail where there is one up, the bar's links otherwise.
function getPanel() {
  const rail = document.querySelector(".main-private .sidebar");

  return rail && !rail.hidden ? rail : document.querySelector(".nav-links");
}

/**
 * Put the account controls where the width says: the foot of the panel on a phone, the bar
 * at every other width.
 *
 * Moved rather than copied. A second copy in the panel would mean a second id for the same
 * button and a second listener to keep in step with it — and `appendChild` carries the
 * element's own listeners with it, so the one `attachNavEvents` set still holds.
 */
function placeAccount() {
  const account = getElement(ACCOUNT_ID);
  const toggle = getElement(TOGGLE_ID);

  if (!account || !toggle) return;

  const panel = matchMedia(PHONE_QUERY).matches ? getPanel() : null;

  if (panel) {
    panel.appendChild(account);
    return;
  }

  toggle.parentElement.insertBefore(account, toggle);
}

// The backdrop is the drawer's own, not a page's, so it is added once beside the page rather
// than written into any shell's markup.
function ensureBackdrop() {
  const existing = getElement(BACKDROP_ID);

  if (existing) return existing;

  const backdrop = document.createElement("div");

  backdrop.className = "nav-backdrop";
  backdrop.id = BACKDROP_ID;

  document.body.appendChild(backdrop);

  return backdrop;
}

// ─── EVENTS ──────────────────────────────────────────────────────────────────

/**
 * Let the button work, and let everything that should close the drawer close it.
 *
 * Called once the bar carrying the button has been written. Returns early without one, so a
 * page with no bar costs nothing.
 */
function attachNavDrawer() {
  const toggle = getElement(TOGGLE_ID);

  if (!toggle) return;

  toggle.addEventListener("click", () => {
    const open = !isDrawerOpen();

    // Placed on the way in as well as on a resize: which panel is the drawer can change
    // after load, when a record page turns out to be the reader's own — see applyShell.
    if (open) placeAccount();

    setDrawerOpen(open);
  });

  ensureBackdrop().addEventListener("click", () => setDrawerOpen(false));

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isDrawerOpen()) {
      setDrawerOpen(false);
    }
  });

  // A link in a panel leaves the page, and a panel left open is the first thing on the next
  // one. Delegated, because both panels are written and rewritten by the modules that own
  // them.
  document.addEventListener("click", (event) => {
    if (event.target?.closest?.(PANEL_LINK)) {
      setDrawerOpen(false);
    }
  });

  // Past the breakpoint the panels are chrome again and the button is gone with it.
  matchMedia(CHROME_QUERY).addEventListener("change", (event) => {
    if (!event.matches) {
      setDrawerOpen(false);
    }
  });

  matchMedia(PHONE_QUERY).addEventListener("change", placeAccount);

  placeAccount();
}

export { ACCOUNT_ID, attachNavDrawer, buildNavToggle };
