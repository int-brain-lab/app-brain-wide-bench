const NAV_LINKS = [
  { label: "Leaderboard", href: "leaderboard.html", match: "leaderboard.html" },
  { label: "Docs", href: "#" },
  { label: "Submit", href: "submit.html", match: "submit.html" },
  { label: "About", href: "#" },
  { label: "Dashboard", href: "dashboard.html", match: "dashboard.html" },
];

function currentPage() {
  return window.location.pathname.split("/").at(-1) || "index.html";
}

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

function renderNavLink(link, page) {
  const activeClass =
    link.match === page ? ' class="active"' : "";

  return `
    <a href="${link.href}"${activeClass}>
      ${link.label}
    </a>
  `;
}

function renderNavLinks(page) {
  const links = NAV_LINKS
    .map(link => renderNavLink(link, page))
    .join("");

  return `
    <nav class="nav-links">
      ${links}
    </nav>
  `;
}

function renderLoginButton() {
  return `
    <a class="btn btn-theme" id="login-btn">
      Sign in
    </a>
  `;
}

function renderUserMenu(user) {
  const name = user.name || user.email;

  return `
    <span class="user-logo user-logo-lg">
      ${initials(name)}
    </span>

    <a class="btn" id="logout-btn">
      Sign out
    </a>
  `;
}

async function getCurrentUser() {
  try {
    const authenticated = await isAuthenticated();

    if (!authenticated) {
      return null;
    }

    return await apiFetch("/api/users/me");
  } catch (err) {
    console.error(err);
    return null;
  }
}

async function renderAuth() {
  const user = await getCurrentUser();

  return `
    <div class="nav-auth">
      ${user
        ? renderUserMenu(user)
        : renderLoginButton()}
    </div>
  `;
}

function attachNavEvents() {
  document
    .getElementById("login-btn")
    ?.addEventListener("click", login);

  document
    .getElementById("logout-btn")
    ?.addEventListener("click", logout);
}

async function renderNav() {
  const page = currentPage();
  const auth = await renderAuth();

  const html = `
    ${renderLogo()}
    ${renderNavLinks(page)}
    ${auth}
  `;

  document.getElementById("top-nav").innerHTML = html;

  attachNavEvents();
}

renderNav();