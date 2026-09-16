// Site footer: who made it, and the ways off the page.
//
// Self-mounting into #page-footer, as navTop.js is into #top-nav, and silent on a page
// without one.
//
// Two repos stand behind the site, so GitHub and Get help each open a short list of them
// rather than naming one. Docs is a single link, and the menus are this module's own: it
// mounts them, opens them, and closes them.
//
// Docs and Get help are Lucide placeholders, filled by the createIcons pass renderHtml makes.
// GitHub is an inline SVG: Lucide carries no brand icons, so there is no name for it.

import { renderHtml } from "../core/render.js";
import { getIcon } from "../components/icons.js";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

// The two repos behind the site, in the order both menus name them.
const REPOS = [
  { label: "BrainWideBench", href: "https://github.com/brainbench-org/ibl-bwb" },
  { label: "Website", href: "https://github.com/int-brain-lab/app-brain-wide-bench" },
];

// A repo's issues: a question belongs there as much as a bug report does.
const ISSUES = REPOS.map(({ label, href }) => ({ label, href: `${href}/issues` }));

const DOCS_HREF = "https://brainbench-org.github.io/ibl-bwb/";

const AUTHOR = "IBL Core";

// The list each trigger opens, named by the trigger's `aria-controls`.
const REPO_MENU_ID = "footer-repos";
const HELP_MENU_ID = "footer-help";

// ─── ICONS ───────────────────────────────────────────────────────────────────

// A logo, so it is its own filled path — and the one icon here Lucide has no name for.
const GITHUB_ICON = `
  <svg class="footer-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577
      0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633
      17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809
      1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93
      0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267
      1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24
      2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81
      2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24
      12.297c0-6.627-5.373-12-12-12" />
  </svg>
`;

// Sized by `.footer-icon`, which createIcons carries onto the svg it swaps in.
const DOCS_ICON = `<i class="footer-icon" data-lucide="${getIcon("docs")}"></i>`;

const HELP_ICON = `<i class="footer-icon" data-lucide="${getIcon("help")}"></i>`;

// Upward, which is the way a list opens from the last band of the page.
const MENU_ICON = `<i class="footer-icon" data-lucide="${getIcon("up")}"></i>`;

// ─── RENDERING ───────────────────────────────────────────────────────────────

// `_blank` on every one of them: all of these leave the site, and a reader clicking through
// from the footer has not finished with the page they were on.
function buildFooterLink({ href, icon = "", label }) {
  return `
    <a class="link icon-link" href="${href}" target="_blank" rel="noopener noreferrer">
      ${icon}
      <span>${label}</span>
    </a>
  `;
}

/**
 * A footer entry standing for more than one destination.
 *
 * @param id    the list's element id, which the trigger names in `aria-controls`.
 * @param icon  markup for the icon on the trigger.
 * @param label the trigger's text.
 * @param items { href, label } per link in the list.
 *
 * @returns the trigger and its list, closed. attachFooterEvents opens it.
 */
function buildFooterMenu({ id, icon, label, items }) {
  return `
    <div class="footer-menu">
      <button type="button" class="link icon-link" aria-controls="${id}" aria-expanded="false">
        ${icon}
        <span>${label}</span>
        ${MENU_ICON}
      </button>

      <div class="footer-menu-list" id="${id}" hidden>
        ${items.map(buildFooterLink).join("")}
      </div>
    </div>
  `;
}

// Read from the clock rather than written in: a hard-coded year is wrong every January.
function buildCredit() {
  return `
    <p class="metadata">© ${new Date().getFullYear()} · by ${AUTHOR}</p>
  `;
}

function buildFooter() {
  return `
    ${buildCredit()}

    <div class="row left gap-xl">
      ${buildFooterMenu({
        id: REPO_MENU_ID,
        icon: GITHUB_ICON,
        label: "GitHub",
        items: REPOS,
      })}
      ${buildFooterLink({ href: DOCS_HREF, icon: DOCS_ICON, label: "Docs" })}
      ${buildFooterMenu({
        id: HELP_MENU_ID,
        icon: HELP_ICON,
        label: "Get help",
        items: ISSUES,
      })}
    </div>
  `;
}

// ─── EVENTS ──────────────────────────────────────────────────────────────────

const MENU = ".footer-menu";
const MENU_TRIGGER = "[aria-controls]";
const MENU_LIST = ".footer-menu-list";

function setMenuOpen(menu, open) {
  menu.querySelector(MENU_TRIGGER).setAttribute("aria-expanded", String(open));
  menu.querySelector(MENU_LIST).hidden = !open;
}

function isClosed(trigger) {
  return trigger?.getAttribute("aria-expanded") === "false";
}

// Every menu closes on any click; the one whose trigger was clicked while closed then opens.
// A click on a link inside an open list closes it on the way out.
function handleClick(footer, event) {
  const trigger = event.target.closest(MENU_TRIGGER);
  const opening = isClosed(trigger) ? trigger.closest(MENU) : null;

  for (const menu of footer.querySelectorAll(MENU)) {
    setMenuOpen(menu, menu === opening);
  }
}

function closeMenus(footer) {
  for (const menu of footer.querySelectorAll(MENU)) {
    setMenuOpen(menu, false);
  }
}

// On the document, not the footer: a click anywhere else on the page closes what is open.
function attachFooterEvents(footer) {
  document.addEventListener("click", (event) => handleClick(footer, event));

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenus(footer);
  });
}

// ─── INITIALISATION ──────────────────────────────────────────────────────────

function getFooter() {
  return document.getElementById("page-footer");
}

function initialiseFooter() {
  const footer = getFooter();

  if (!footer) {
    return;
  }

  renderHtml(footer, buildFooter(), { refresh: true });

  attachFooterEvents(footer);
}

initialiseFooter();

export { buildFooter };
