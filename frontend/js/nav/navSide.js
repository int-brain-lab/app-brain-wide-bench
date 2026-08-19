import { initials} from "../core/utils.js";
import { getIcon } from "../components/icons.js";
import { apiFetch, isAuthenticated, logout } from "../api/client.js";
import { renderLogo } from "./navTop.js";
// ─── CONSTANTS ─────────────────────────────────────────────────────────────

// "My" throughout, because every one of these is scoped to the viewer — the public
// counterparts below list the same domains unscoped, and the labels are what tells them
// apart in a rail where both appear.
const MAIN_NAV_ITEMS = [
  { label: "My dashboard", href: "/html/dashboard/dashboard.html", icon: getIcon("dashboard") },
  { label: "My models", href: "/html/models/model_list.html", icon: getIcon("model") },
  { label: "My submissions", href: "/html/submissions/submission_list.html", icon: getIcon("submission") },
  { label: "My teams", href: "/html/teams/team_list.html", icon: getIcon("team") },
  { label: "My settings", href: "/html/users/user_details.html", icon: getIcon("settings") },
];

const PUBLIC_NAV_ITEMS = [
  { label: "Leaderboard", href: "/html/leaderboard/leaderboard.html", icon: getIcon("leaderboard") },
  { label: "All models", href: "/html/models/model_list_public.html", icon: getIcon("model") },
  { label: "All submissions", href: "/html/submissions/submission_list_public.html", icon: getIcon("submission") },
  { label: "All teams", href: "/html/teams/team_list_public.html", icon: getIcon("team") },
  { label: "Home", href: "/index.html", icon: getIcon("home") },
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

function sidebar() {
  return document.getElementById("side-nav");
}


// ─── HELPERS ────────────────────────────────────────────────────────────────

// The whole path, not just the filename. Nav hrefs became root-relative when pages
// stopped all living at the same depth (models are under /html/models/), and this is
// compared against them to mark the active item — so it has to be the same shape.
function currentPage() {
  const path = window.location.pathname;

  return path === "/" ? "/index.html" : path;
}


// ─── RENDERING ──────────────────────────────────────────────────────────────

function renderSidebarItem(item, page) {
  const active = item.href === page;

  return `
    <a class="sidebar-item${active ? " active" : ""}" href="${item.href}">
      <i class="sidebar-icon" data-lucide="${item.icon}"></i>
      ${item.label}
    </a>
  `;
}

function renderSidebarItems(items, page) {
  return items
    .map(item => renderSidebarItem(item, page))
    .join("");
}

function renderSidebar() {
  const page = currentPage();

  return `
    <a class="sidebar-logo" href="/index.html">
      ${renderLogo()}
    </a>

    <div class="sidebar-section">
      ${renderSidebarItems(MAIN_NAV_ITEMS, page)}
    </div>

    <hr class="sidebar-divider">

    <div class="sidebar-section">
      ${renderSidebarItems(PUBLIC_NAV_ITEMS, page)}
    </div>

    <div class="sidebar-bottom">
      <div class="row left gap-md">
        <div class="user-logo" id="user-initials">—</div>
        <a class="btn primary" id="sidebar-logout">Sign out</a>
      </div>
    </div>
  `;
}




// ─── USER ───────────────────────────────────────────────────────────────────

// Exported so the settings page can re-run it after a rename — the initials are taken from
// the name, so they go stale with it. The lookup is optional because an external caller
// can't assume renderSidebar() has run.
async function fillSidebarUser() {
  const user = await loadCurrentUser();

  if (!user) {
    return;
  }

  const initialsElement = document.getElementById("user-initials");

  if (initialsElement) {
    initialsElement.textContent = initials(user.name || user.email);
  }
}


// ─── INITIALISATION ─────────────────────────────────────────────────────────

async function initialiseSidebar() {
  const nav = sidebar();

  if (!nav) {
    return;
  }

  nav.innerHTML = renderSidebar();

  // Straight back to the public home, which logout() is already pointed at.
  document
    .getElementById("sidebar-logout")
    ?.addEventListener("click", () => logout());

  await fillSidebarUser();

  lucide.createIcons();

}

initialiseSidebar();

export { fillSidebarUser };