import { escapeHtml } from "../core/html.js";
import { renderHtml } from "../core/render.js";
import { initials } from "../core/utils.js";
import { login, logout } from "../api/client.js";
import { getCurrentUser } from "../api/userApi.js";
import { buildSignInButton, buildSignOutButton } from "../components/buttons.js";
import { DOCS_HREF } from "./navFooter.js";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

// Where signing in lands, and where the nav item, the avatar and the sign-in button point.
const DASHBOARD_HREF = "/html/dashboard/dashboard.html";

const HOME_HREF = "/index.html";

// The public surface, in the order a reader meets it — the scores, then what produced
// them — with the way into the signed-in half last. Models is the unscoped list, the same
// page the sidebar's "My models" is at data-scope="mine"; Tasks is every scored task, which
// is the sidebar's "All tasks".
const NAV_ITEMS = [
  { label: "Leaderboard", href: "/html/leaderboard/leaderboard.html" },
  { label: "Models", href: "/html/models/model_list_public.html" },
  { label: "Tasks", href: "/html/tasks/task_list_public.html" },
  { label: "Teams", href: "/html/teams/team_list_public.html" },
  { label: "Documentation", href: DOCS_HREF, external: true },
  { label: "My dashboard", href: DASHBOARD_HREF },
];

// ─── DOM ─────────────────────────────────────────────────────────────────────

function topNav() {
  return document.getElementById("top-nav");
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

// The whole path, not just the filename — nav hrefs are root-relative now that pages
// live at more than one depth, and this is compared against them to mark the active
// item. Same as nav_side.js.
function currentPage() {
  const path = window.location.pathname;

  return path === "/" ? "/index.html" : path;
}

// ─── RENDERING ───────────────────────────────────────────────────────────────

// The brand mark, exported because nav_side.js puts the same one at the top of the
// sidebar. It used to be its own module to avoid importing this file from there —
// initialiseNav() runs at import time, and on a private page with no top nav that was a
// crash. It returns early on a missing #top-nav now, so importing this from the sidebar
// costs nothing but the module evaluation.
//
// `new URL` rather than the path written out: the build hashes the files it emits, and a
// plain "/img/logo.png" inside a string is not a reference it can see. Resolved against this
// module either way, so the unbuilt source serves the same file.
const LOGO_SRC = new URL("../../img/logo.png", import.meta.url).href;

// Empty `alt`: the wordmark beside it is the name, and a screen reader reading both says it
// twice.
function renderLogo() {
  return `
    <div class="nav-logo">
      <img class="nav-logo-mark" src="${LOGO_SRC}" alt="" />

      <span>BrainWideBench</span>
    </div>
  `;
}

// `external` is a page off this site, which never matches the path `active` is decided by.
function renderNavItem(item, page) {
  const active = item.href === page;

  return `
    <a
      href="${item.href}"
      ${active ? 'class="active"' : ""}
      ${item.external ? 'target="_blank" rel="noopener noreferrer"' : ""}
    >
      ${item.label}
    </a>
  `;
}

function renderNavLinks(page) {
  return `
    <nav class="nav-links">
      ${NAV_ITEMS.map((item) => renderNavItem(item, page)).join("")}
    </nav>
  `;
}

// Both are looked up by id once the nav is written — see attachNavEvents.
const LOGIN_ID = "login-btn";
const LOGOUT_ID = "logout-btn";

function renderLoginButton() {
  return buildSignInButton({ id: LOGIN_ID });
}

// `initials` takes the leading character of each word, so a display name
// starting with "<" survives into the markup — escape it like any other
// value that came off /api/users/me.
function renderUserMenu(user) {
  const name = user.name || user.email;

  return `
    <a class="user-logo" href="${DASHBOARD_HREF}" title="My dashboard">
      ${escapeHtml(initials(name))}
    </a>

    ${buildSignOutButton({ id: LOGOUT_ID })}
  `;
}

async function renderAuthSection() {
  const user = await getCurrentUser();

  return `
    <div class="nav-auth">
      ${user ? renderUserMenu(user) : renderLoginButton()}
    </div>
  `;
}

// ─── EVENTS ──────────────────────────────────────────────────────────────────

function attachNavEvents() {
  // Arrows, not the bare functions: a listener is called with the click event, and `login`
  // now reads its first argument as the page to return to.
  document.getElementById(LOGIN_ID)?.addEventListener("click", () => login(DASHBOARD_HREF));

  document.getElementById(LOGOUT_ID)?.addEventListener("click", () => logout());
}

// ─── INITIALISATION ──────────────────────────────────────────────────────────

async function initialiseNav() {
  const nav = topNav();

  if (!nav) {
    return;
  }

  // The link lives here rather than inside renderLogo: the sidebar wraps the same mark in
  // its own anchor, and an <a> inside an <a> is invalid.
  renderHtml(
    nav,
    `
    <a href="${HOME_HREF}">${renderLogo()}</a>
    ${renderNavLinks(currentPage())}
    ${await renderAuthSection()}
  `,
  );

  attachNavEvents();
}

initialiseNav();

export { renderLogo };
