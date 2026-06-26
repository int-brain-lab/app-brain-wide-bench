
const SIDE_ICON = (paths) =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${paths}</svg>`;

const SIDE_MAIN = [
  { label: "Dashboard", href: "dashboard.html", match: "dashboard.html",
    icon: SIDE_ICON('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>') },
  { label: "Evaluation",
    icon: SIDE_ICON('<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>') },
  { label: "Settings",
    icon: SIDE_ICON('<circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 010 14.14M4.93 4.93a10 10 0 000 14.14"/>') },
];

const SIDE_PUBLIC = [
  { label: "Leaderboard", href: "leaderboard.html",
    icon: SIDE_ICON('<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>') },
  { label: "Home", href: "index.html",
    icon: SIDE_ICON('<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>') },
];

// Render one row. The active row is a non-link div (you're already there); other rows
// with an href are links, and href-less placeholders stay plain divs.
function sideItem(item, page) {
  const active = item.match === page;
  const body = `${item.icon}\n        ${item.label}\n      `;
  if (item.href && !active) {
    return `<a class="nav-item" href="${item.href}">${body}</a>`;
  }
  return `<div class="nav-item${active ? " active" : ""}">${body}</div>`;
}

function sideMarkup() {
  const page = window.location.pathname.split("/").pop() || "index.html";
  const main = SIDE_MAIN.map((i) => sideItem(i, page)).join("\n      ");
  const pub = SIDE_PUBLIC.map((i) => sideItem(i, page)).join("\n      ");
  return `
    <div class="nav-section">
      ${main}
    </div>

    <hr class="nav-divider">

    <div class="nav-section" style="padding-top:4px">
      <div class="nav-label">Public</div>
      ${pub}
    </div>

    <div class="sidebar-bottom">
      <div class="avatar-row">
        <div class="user-logo" id="user-initials">—</div>
        <div>
          <div class="avatar-name" id="user-name">…</div>
          <div class="avatar-role" id="user-affiliation"></div>
        </div>
      </div>
    </div>`;
}

// Fill the bottom avatar row directly. Dashboard/model pages already do this via
// model-view.js's setSidebarUser() (called once their data loads), so we only handle
// it here on pages that lack that helper (index, leaderboard).
async function fillSideAvatar() {
  if (typeof setSidebarUser === "function") return;
  try {
    const user = await getJSON("/api/users/me");
    document.getElementById("user-name").textContent = user.name || user.email;
    document.getElementById("user-affiliation").textContent = user.affiliation || "";
    document.getElementById("user-initials").textContent = initials(user.name || user.email);
  } catch (e) {
    /* leave the placeholder dashes */
  }
}

async function renderSideNav() {
  const aside = document.getElementById("side-nav");
  if (!aside) return;
  aside.innerHTML = sideMarkup();

  // On public pages (index, leaderboard) the sidebar is only revealed once signed
  // in; body.is-authed drives that via CSS. Dashboard/model always show it.
  await initAuth();
  if (await isAuthenticated()) {
    document.body.classList.add("is-authed");
    await fillSideAvatar();
  }
}

renderSideNav();
