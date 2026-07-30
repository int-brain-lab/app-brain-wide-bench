import { escapeHtml, initials} from "./utils.js";
import { apiFetch, isAuthenticated, login, logout } from "./api.js";

// ─── CONSTANTS ─────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { label: "Leaderboard", href: "leaderboard.html" },
  { label: "Docs", href: "#" },
  { label: "Submit", href: "submit_submission.html" },
  { label: "About", href: "#" },
  { label: "Dashboard", href: "dashboard.html" },
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

function currentPage() {
  return window.location.pathname.split("/").pop() || "index.html";
}


// ─── RENDERING ──────────────────────────────────────────────────────────────

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