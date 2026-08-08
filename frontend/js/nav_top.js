import { escapeHtml, initials} from "./utils.js";
import { apiFetch, isAuthenticated, login, logout } from "./api.js";
import { renderLogo } from "./logo.js";

// ─── CONSTANTS ─────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { label: "Leaderboard", href: "/leaderboard.html" },
  { label: "Docs", href: "#" },
  { label: "Submit", href: "/submit_submission.html" },
  { label: "About", href: "#" },
  { label: "Dashboard", href: "/html/dashboard/dashboard.html" },
];


// ─── API ────────────────────────────────────────────────────────────────────

async function loadCurrentUser() {
  try {
    if (!(await isAuthenticated())) {
      return null;
    }

    return await apiFetch("/api/users/me");

  } catch (err) {
    console.error(err);
    return null;
  }
}


// ─── DOM ────────────────────────────────────────────────────────────────────

function topNav() {
  return document.getElementById("top-nav");
}


// ─── HELPERS ────────────────────────────────────────────────────────────────

// The whole path, not just the filename — nav hrefs are root-relative now that pages
// live at more than one depth, and this is compared against them to mark the active
// item. Same as nav_side.js.
function currentPage() {
  const path = window.location.pathname;

  return path === "/" ? "/index.html" : path;
}


// ─── RENDERING ──────────────────────────────────────────────────────────────

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
      ${NAV_ITEMS.map(item => renderNavItem(item, page)).join("")}
    </nav>
  `;
}

function renderLoginButton() {
  return `
    <a class="btn primary" id="login-btn">
      Sign in
    </a>
  `;
}

// `initials` takes the leading character of each word, so a display name
// starting with "<" survives into the markup — escape it like any other
// value that came off /api/users/me.
function renderUserMenu(user) {
  const name = user.name || user.email;

  return `
    <span class="user-logo large">
      ${escapeHtml(initials(name))}
    </span>

    <a class="btn" id="logout-btn">
      Sign out
    </a>
  `;
}

async function renderAuthSection() {
  const user = await loadCurrentUser();

  return `
    <div class="nav-auth">
      ${user
        ? renderUserMenu(user)
        : renderLoginButton()}
    </div>
  `;
}


// ─── EVENTS ─────────────────────────────────────────────────────────────────

function attachNavEvents() {
  document
    .getElementById("login-btn")
    ?.addEventListener("click", login);

  document
    .getElementById("logout-btn")
    ?.addEventListener("click", logout);
}


// ─── INITIALISATION ─────────────────────────────────────────────────────────

async function initialiseNav() {
  const nav = topNav();

  if (!nav) {

    return;
  }

  nav.innerHTML = `
    ${renderLogo()}
    ${renderNavLinks(currentPage())}
    ${await renderAuthSection()}
  `;

  attachNavEvents();
}

initialiseNav();