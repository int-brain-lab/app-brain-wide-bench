// When true, GET requests are served from the static mock JSON in mock_api/
// instead of the backend (POST/PUT/PATCH still hit the network). Lets the
// frontend run with no backend at all. See mock_api/README.md.
const FAKE_DATA = false;
// Anchor the mock dir to THIS script's URL (frontend/js/api.js), not the page URL,
// so it resolves to frontend/mock_api/ no matter which page loads it or how the
// site is served. mock_api/ is a sibling of js/, hence "../mock_api".
const FAKE_DATA_BASE = new URL("../mock_api", document.currentScript.src).href;

// Map a GET API path to its mock file. Returns null if there's no mapping.
function fakeDataFile(path) {
  const clean = path.split("?")[0].replace(/\/+$/, ""); // drop query + trailing slash
  const exact = {
    "/api/leaderboard": "leaderboard.json",
    "/api/users/me/models": "user_models.json",
    "/api/users/me": "users_me.json",
    "/api/tasks": "tasks.json",
    "/api/teams": "teams.json",
    "/api/models": "models.json",
    "/api/models_details": "models_details.json",
    "/api/submissions": "submissions_list.json", // list (trailing slash stripped)
  };
  if (clean in exact) return exact[clean];
  if (/^\/api\/submissions\/[^/]+$/.test(clean)) return "submission_detail.json"; // detail
  if (/^\/api\/models\/[^/]+$/.test(clean)) return "models_details.json"; // model + submissions
  return null;
}



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


  const method = (options.method || "GET").toUpperCase();

  // FAKE_DATA: serve GETs from static mock JSON; let writes fall through.
  if (FAKE_DATA && method === "GET") {
    const file = fakeDataFile(path);
    console.log(file)
    if (file) {
      const res = await fetch(`${FAKE_DATA_BASE}/${file}`);
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}: mock file ${file} missing`);
      }
      return res.json();
    }
    console.warn(`FAKE_DATA: no mock mapping for GET ${path}; using network`);
  }



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