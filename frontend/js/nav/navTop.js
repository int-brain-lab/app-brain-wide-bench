import { escapeHtml } from "../core/html.js";
import { renderHtml } from "../core/render.js";
import { initials } from "../core/utils.js";
import { login, logout } from "../api/client.js";
import { getCurrentUser } from "../api/userApi.js";
import { buildSignInButton, buildSignOutButton } from "../components/buttons.js";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

// The public surface, in the order a reader meets it — the scores, then what produced
// them — with the way into the signed-in half last. Models is the unscoped list, the same
// page the sidebar's "My models" is at data-scope="mine"; Tasks is every scored task, which
// is the sidebar's "All tasks".
// Where signing in lands, and the nav item that names it — one constant, so the button and
// the link can't drift apart.
const DASHBOARD_HREF = "/html/dashboard/dashboard.html";

const HOME_HREF = "/index.html";

const NAV_ITEMS = [
  { label: "Leaderboard", href: "/html/leaderboard/leaderboard.html" },
  { label: "Models", href: "/html/models/model_list_public.html" },
  { label: "Tasks", href: "/html/tasks/task_list_public.html" },
  { label: "Teams", href: "/html/teams/team_list_public.html" },
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
// An inline SVG rather than a Lucide placeholder: it isn't a Lucide icon, and it needs no
// createIcons() pass to appear.
function renderLogo() {
  return `
    <div class="nav-logo">
      <div class="nav-logo-mark">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="5" stroke="white" stroke-width="1.5" />
          <circle cx="8" cy="8" r="2" fill="white" />
        </svg>
      </div>

      <span>brain-wide bench</span>
    </div>
  `;
}

function renderNavItem(item, page) {
  const active = item.href === page;

  return `
    <a
      href="${item.href}"
      ${active ? 'class="active"' : ""}
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
    <span class="user-logo">
      ${escapeHtml(initials(name))}
    </span>

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
