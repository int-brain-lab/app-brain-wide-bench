const CONFIG = {
  apiBase: "", // same origin; set to e.g. "http://localhost:8080" for split hosting
  auth0Domain: "dev-dmv00yvt1n0i036m.us.auth0.com",
  auth0ClientId: "YOUR_AUTH0_CLIENT_ID",
  auth0Audience: "https://brainwidebench.iblcore.org",
};

const FAKE_SESSION_KEY = "signed_in"; // localStorage flag used in fake mode
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
  if (DEV_MODE) return localStorage.getItem(FAKE_SESSION_KEY) === "1";
  return auth0Client ? auth0Client.isAuthenticated() : false;
}

async function login() {
  if (DEV_MODE) {
    localStorage.setItem(FAKE_SESSION_KEY, "1");
    window.location.reload();
    return;
  }
  await auth0Client.loginWithRedirect();
}

async function logout() {
  if (DEV_MODE) {
    localStorage.removeItem(FAKE_SESSION_KEY);
    window.location.href = "index.html";
    return;
  }
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