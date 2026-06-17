// Shared frontend logic: Auth0 SPA SDK wiring + fetch helpers.
//
// Configure Auth0 by editing CONFIG below. If clientId is left as the placeholder
// the app runs in "dev" mode: login is a no-op and requests carry no bearer token,
// matching the backend's AUTH0_DOMAIN=dev stub.

const CONFIG = {
  apiBase: "", // same origin; set to e.g. "http://localhost:8080" for split hosting
  auth0Domain: "dev-dmv00yvt1n0i036m.us.auth0.com",
  auth0ClientId: "jYERzEVe5MWl0r8SKGshQLRvxswseQlS",
  auth0Audience: "https://brainwidebench.iblcore.org",
};

const DEV_MODE = CONFIG.auth0ClientId === "YOUR_AUTH0_CLIENT_ID";

let auth0Client = null;

async function initAuth() {
  if (DEV_MODE) return null;
  try {
    auth0Client = await auth0.createAuth0Client({
      domain: CONFIG.auth0Domain,
      clientId: CONFIG.auth0ClientId,
      authorizationParams: {
        audience: CONFIG.auth0Audience,
        redirect_uri: window.location.origin + window.location.pathname,
      },
    });
    // Handle the redirect callback.
    const q = window.location.search;
    if (q.includes("code=") && q.includes("state=")) {
      await auth0Client.handleRedirectCallback();
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  } catch (e) {
    // Auth0 unavailable or misconfigured — degrade gracefully (public pages still load).
    console.warn("Auth0 init failed:", e);
    auth0Client = null;
  }
  return auth0Client;
}

async function isAuthenticated() {
  if (DEV_MODE) return true;
  return auth0Client ? auth0Client.isAuthenticated() : false;
}

async function login() {
  if (DEV_MODE) return; // no-op
  await auth0Client.loginWithRedirect();
}

async function logout() {
  if (DEV_MODE) return;
  await auth0Client.logout({ logoutParams: { returnTo: window.location.origin } });
}

async function getToken() {
  if (DEV_MODE || !auth0Client) return null;
  try {
    return await auth0Client.getTokenSilently();
  } catch {
    // Not authenticated or Auth0 error — proceed without a token.
    return null;
  }
}

// Fetch wrapper that injects the bearer token when available.
async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = await getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(CONFIG.apiBase + path, { ...options, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.status === 204 ? null : res.json();
}

// Render the login/logout button + user badge in the navbar.
async function renderNav() {
  const slot = document.getElementById("auth-slot");
  if (!slot) return;
  const authed = await isAuthenticated();
  if (!authed) {
    slot.innerHTML = `<button id="login-btn">Login</button>`;
    document.getElementById("login-btn").onclick = login;
    return;
  }
  let user = null;
  try {
    user = await apiFetch("/api/users/me");
  } catch (e) {
    /* dev mode upserts on first call; ignore transient errors */
  }
  const orcid =
    user && user.orcid_id
      ? `<a class="orcid" href="https://orcid.org/${user.orcid_id}" target="_blank">iD ${user.orcid_id}</a>`
      : "";
  const name = user ? user.name || user.email : "Account";
  slot.innerHTML = `<span class="user">${name}</span> ${orcid} <button id="logout-btn">Logout</button>`;
  document.getElementById("logout-btn").onclick = logout;
}

// Sortable table helper: clicking a th toggles asc/desc on its data key.
function makeSortable(table, getRows, render) {
  let sortKey = null;
  let asc = true;
  table.querySelectorAll("th[data-key]").forEach((th) => {
    th.style.cursor = "pointer";
    th.onclick = () => {
      const key = th.dataset.key;
      asc = sortKey === key ? !asc : true;
      sortKey = key;
      const rows = getRows().slice().sort((a, b) => {
        const va = a._sort[key];
        const vb = b._sort[key];
        if (va == null) return 1;
        if (vb == null) return -1;
        if (va < vb) return asc ? -1 : 1;
        if (va > vb) return asc ? 1 : -1;
        return 0;
      });
      render(rows);
    };
  });
}
