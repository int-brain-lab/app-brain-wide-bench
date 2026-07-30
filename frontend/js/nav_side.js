import { initials} from "./utils.js";
import { apiFetch, isAuthenticated } from "./api.js";
// ─── CONSTANTS ─────────────────────────────────────────────────────────────

const MAIN_NAV_ITEMS = [
  { label: "Dashboard", href: "dashboard.html", icon: "layout-grid" },
  { label: "Models", href: "model_list.html", icon: "chart-column" },
  { label: "Submissions", href: "submission_list.html", icon: "chart-column" },
  { label: "Teams", href: "my_teams.html", icon: "chart-column" },
  { label: "Settings", href: "my_settings.html", icon: "settings" },
];

const PUBLIC_NAV_ITEMS = [
  { label: "Leaderboard", href: "leaderboard.html", icon: "trophy" },
  { label: "Home", href: "index.html", icon: "house" },
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

function currentPage() {
  return window.location.pathname.split("/").pop() || "index.html";
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

async function fillSidebarUser() {

    const user = await loadCurrentUser();

    if (!user) {
      return;
    }

    const name = user.name || user.email;

    document.getElementById("user-name").textContent = name;
    document.getElementById("user-initials").textContent = initials(name);
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