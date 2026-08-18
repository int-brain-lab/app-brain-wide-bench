
const CONFIG = {
  apiBase: "", // same origin; set to e.g. "http://localhost:8080" for split hosting
  auth0Domain: "dev-dmv00yvt1n0i036m.us.auth0.com",
  auth0ClientId: "jYERzEVe5MWl0r8SKGshQLRvxswseQlS",
  auth0Audience: "https://brainwidebench.iblcore.org",
};

// Every sign-in returns here, whichever page it started from, so Auth0 needs one entry
// in Allowed Callback URLs rather than one per page. Where the user was is carried in
// `appState` and restored below. index.html because it is public and cheap to render.
const CALLBACK_PATH = "/index.html";

const DEV_MODE = CONFIG.auth0ClientId === "YOUR_AUTH0_CLIENT_ID";
const FAKE_SESSION_KEY = "signed_in"; // localStorage flag used in fake mode

let auth0Client = null;

// The in-flight (or settled) initAuth call.
//
// Memoised rather than called by each page: nine places ask `isAuthenticated()` — both
// nav modules, the record and list page loaders, and five page scripts — and a page that
// forgot to initialise first would silently send no token and get a 401 that reads like
// "not signed in". The nav and the page script are also separate module graphs, so their
// order isn't guaranteed; one shared promise removes the race and guarantees the redirect
// callback is handled exactly once.
let authReady = null;

function ensureAuth() {
  authReady ??= initAuth();

  return authReady;
}

async function initAuth() {
  if (DEV_MODE) return null;
  try {
    auth0Client = await auth0.createAuth0Client({
      domain: CONFIG.auth0Domain,
      clientId: CONFIG.auth0ClientId,
      authorizationParams: {
        audience: CONFIG.auth0Audience,
        redirect_uri: window.location.origin + CALLBACK_PATH,
      },
      // Needed because this is a multi-page app: every link is a full navigation, which
      // discards the default in-memory token cache. Without this, each page load would
      // need a silent re-auth through a hidden iframe — which browsers that block
      // third-party cookies refuse, so sign-in would appear to work and then every page
      // after the first would 401.
      cacheLocation: "localstorage",
    });

    // Handle the redirect callback.
    const q = window.location.search;
    if (q.includes("code=") && q.includes("state=")) {
      const { appState } = await auth0Client.handleRedirectCallback();
      window.history.replaceState({}, document.title, window.location.pathname);

      // Back to the page they were on when they clicked Sign in. Skipped when that is
      // already here, which would otherwise be a reload loop.
      const returnTo = appState?.returnTo;
      if (returnTo && returnTo !== window.location.pathname + window.location.search) {
        window.location.replace(returnTo);
      }
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

  await ensureAuth();

  return auth0Client ? auth0Client.isAuthenticated() : false;
}

async function login() {
  if (DEV_MODE) {
    localStorage.setItem(FAKE_SESSION_KEY, "1");
    window.location.reload();
    return;
  }
  await ensureAuth();

  // `returnTo` rather than a per-page redirect_uri: the callback always lands on
  // CALLBACK_PATH, and initAuth sends them on from there.
  await auth0Client.loginWithRedirect({
    appState: { returnTo: window.location.pathname + window.location.search },
  });
}

async function logout() {
  if (DEV_MODE) {
    localStorage.removeItem(FAKE_SESSION_KEY);
    window.location.href = "index.html";
    return;
  }
  await ensureAuth();

  await auth0Client.logout({ logoutParams: { returnTo: window.location.origin } });
}

async function getToken() {
  if (DEV_MODE) return null;

  await ensureAuth();

  if (!auth0Client) return null;

  try {
    return await auth0Client.getTokenSilently();
  } catch (err) {
    // Still null — the caller proceeds unauthenticated and the server answers 401 — but
    // logged, because an expired session and a missing one produce the same 401 and only
    // this line distinguishes them.
    console.warn("Could not get an access token:", err);

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


// `CONFIG`, `getToken` and `initAuth` stay module-private — everything outside goes
// through apiFetch, and initialisation happens on demand via ensureAuth() so no caller
// can forget it. `auth0` is expected as a CDN global inside initAuth (see the
// auth0-spa-js script tag in every page); that call is wrapped in try/catch and DEV_MODE
// short-circuits it.
export { apiFetch, isAuthenticated, login, logout, CONFIG };



