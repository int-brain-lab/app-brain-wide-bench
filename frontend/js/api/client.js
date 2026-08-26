const CONFIG = {
  apiBase: "", // same origin; set to e.g. "http://localhost:8080" for split hosting
  // auth0Domain: "dev-dmv00yvt1n0i036m.us.auth0.com",
  auth0Domain: "YOUR_AUTH0_DOMAIN",
  // The sentinel `devMode` reads, so a local run signs in against the API's stub user
  // rather than the real tenant. Swap the two lines back to test a genuine sign-in.
  // auth0ClientId: "jYERzEVe5MWl0r8SKGshQLRvxswseQlS",
  auth0ClientId: "YOUR_AUTH0_CLIENT_ID",
  auth0Audience: "https://brainwidebench.iblcore.org",
};

// Every sign-in returns here, whichever page it started from, so Auth0 needs one entry
// in Allowed Callback URLs rather than one per page. Where the user was is carried in
// `appState` and restored below. index.html because it is public and cheap to render.
const CALLBACK_PATH = "/index.html";

// Stub sign-in: no Auth0 at all, just a localStorage flag, matching an API that skips JWT
// verification and answers as its stub user.
//
// Two ways in. An unfilled config is the obvious one. The other is the API telling us it
// runs with AUTH0_DOMAIN=dev (GET /api/meta/auth): the config above is committed and real,
// so a local API in dev mode would otherwise send the user through a genuine Auth0 sign-in
// whose token it then ignores — the browser signed in as a person, the API answering as
// the stub user, and every "why am I seeing someone else's data" that follows.
//
// Resolved rather than declared, so nothing may read it before ensureAuth() has settled.
let devMode = CONFIG.auth0ClientId === "YOUR_AUTH0_CLIENT_ID";

const FAKE_SESSION_KEY = "signed_in"; // localStorage flag used in fake mode

// Sent as the bearer token once signed in locally. Its value is never read — dev mode skips
// verification — but its *presence* is: the API takes a request with no header as anonymous
// in either mode, so this is what makes signing out locally mean something.
const DEV_TOKEN = "dev";

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
  devMode = devMode || false;

  if (devMode) return null;

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
      if (
        returnTo &&
        returnTo !== window.location.pathname + window.location.search
      ) {
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
  await ensureAuth();

  if (devMode) return localStorage.getItem(FAKE_SESSION_KEY) === "1";

  return auth0Client ? auth0Client.isAuthenticated() : false;
}

/**
 * @param returnTo where to land once signed in. Defaults to the page the user is on, which
 *                 is what a gate wants; a Sign in button that isn't about this page — the
 *                 top nav's — passes somewhere better.
 */
async function login(
  returnTo = window.location.pathname + window.location.search,
) {
  await ensureAuth();

  if (devMode) {
    localStorage.setItem(FAKE_SESSION_KEY, "1");
    window.location.assign(returnTo);
    return;
  }

  // `returnTo` rather than a per-page redirect_uri: the callback always lands on
  // CALLBACK_PATH, and initAuth sends them on from there.
  await auth0Client.loginWithRedirect({ appState: { returnTo } });
}

async function logout() {
  await ensureAuth();

  if (devMode) {
    localStorage.removeItem(FAKE_SESSION_KEY);
    window.location.href = "/index.html";
    return;
  }

  await auth0Client.logout({
    logoutParams: { returnTo: window.location.origin },
  });
}

async function getToken() {
  await ensureAuth();

  if (!auth0Client && !devMode) return null;

  // A visitor with no session has no token to renew, and getTokenSilently would still open
  // a hidden /authorize iframe (`prompt=none`) to establish that — a round trip on every
  // public page, which now means the landing page, the leaderboard, and every model and
  // submission page. Worse, an iframe that is blocked rather than refused never fires its
  // load event, so the SDK waits out its full timeout and the page appears to hang.
  //
  // The cached session is what the rest of the app already means by signed in, so this
  // agrees with the gate and the nav. The cost is that an SSO session Auth0 holds but this
  // browser hasn't cached reads as signed out until Sign in is clicked — which then
  // completes without a prompt.
  if (!(await isAuthenticated())) return null;

  if (devMode) return DEV_TOKEN;

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
    const error = new Error(`${res.status} ${res.statusText}: ${text}`);

    // A caller that can act on the difference needs the code itself, not a string to
    // re-parse: a record page tells "no such record" (404) from "the API is down" apart
    // to decide whether to offer a sign-in.
    error.status = res.status;

    throw error;
  }
  return res.status === 204 ? null : res.json();
}

// Best-effort read wrapper for data that decorates a page rather than making it possible.
// Logs the failure once here, then returns the caller's chosen fallback shape.
async function apiFetchOptional(path, { fallback = null, options } = {}) {
  try {
    return await apiFetch(path, options);
  } catch (error) {
    console.error(error);
    return fallback;
  }
}

// `CONFIG`, `getToken` and `initAuth` stay module-private — everything outside goes
// through apiFetch, and initialisation happens on demand via ensureAuth() so no caller
// can forget it. `auth0` is expected as a CDN global inside initAuth (see the
// auth0-spa-js script tag in every page); that call is wrapped in try/catch and dev mode
// short-circuits it.
export { apiFetch, apiFetchOptional, isAuthenticated, login, logout, CONFIG };
