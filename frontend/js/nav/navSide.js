import { initials} from "../core/utils.js";
import { apiFetch, isAuthenticated } from "../api/client.js";
import { renderLogo } from "./navTop.js";
// ─── CONSTANTS ─────────────────────────────────────────────────────────────

// "My" throughout, because every one of these is scoped to the viewer — the public
// counterparts below list the same domains unscoped, and the labels are what tells them
// apart in a rail where both appear.
const MAIN_NAV_ITEMS = [
  { label: "My dashboard", href: "/html/dashboard/dashboard.html", icon: "layout-grid" },
  { label: "My models", href: "/html/models/model_list.html", icon: "chart-column" },
  { label: "My submissions", href: "/html/submissions/submission_list.html", icon: "layers" },
  { label: "My teams", href: "/html/teams/team_list.html", icon: "users" },
  { label: "My settings", href: "/html/users/user_details.html", icon: "settings" },
];

const PUBLIC_NAV_ITEMS = [
  { label: "Leaderboard", href: "/html/leaderboard/leaderboard.html", icon: "trophy" },
  { label: "All models", href: "/html/models/model_list_public.html", icon: "chart-column" },
  { label: "All submissions", href: "/html/submissions/submission_list_public.html", icon: "layers" },
  { label: "Home", href: "/index.html", icon: "house" },
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
         <div class="text-md muted bold" id="user-name">…</div>
      </div>
    </div>
  `;
}




// ─── USER ───────────────────────────────────────────────────────────────────

// Exported so the settings page can re-run it after a rename — otherwise the
// sidebar keeps showing the old name until the next navigation. The lookups are
// optional because an external caller can't assume renderSidebar() has run.
async function fillSidebarUser() {

    const user = await loadCurrentUser();

    if (!user) {
      return;
    }

    const name = user.name || user.email;

    const nameElement = document.getElementById("user-name");
    const initialsElement = document.getElementById("user-initials");

    if (nameElement) nameElement.textContent = name;
    if (initialsElement) initialsElement.textContent = initials(name);
}


// ─── INITIALISATION ─────────────────────────────────────────────────────────

async function initialiseSidebar() {
  const nav = sidebar();

  if (!nav) {
    return;
  }

  nav.innerHTML = renderSidebar();

  await fillSidebarUser();

  lucide.createIcons();

}

initialiseSidebar();

export { fillSidebarUser };