// Authenticated access to the API.
//
// Owns the Auth0 session and the bearer token, and is the only place a request to the API
// is made from. Callers use `apiFetch`; the session initialises itself on first use, so no
// page has to remember to boot it.
//
// `auth0` is a CDN global, from the auth0-spa-js script tag every page carries.

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

const CONFIG = {
  apiBase: "", // same origin; set to e.g. "http://localhost:8080" for split hosting
};

// Auth0's Allowed Callback URLs must contain exactly `origin + this`. Ports and trailing
// slashes count.
const CALLBACK_PATH = "/index.html";

const FAKE_SESSION_KEY = "signed_in";

// Its presence is what the API reads as signed in; its value is never checked.
const DEV_TOKEN = "dev";

let auth0Client = null;

// Whether the API answered GET /api/meta/auth-config with dev_mode: true — i.e. whether
// AUTH0_DOMAIN=dev on the backend. Read from the backend rather than a second,
// hand-maintained flag here, so the two can't drift apart: a stubbed frontend talking to a
// verifying backend gets a `Bearer dev` that 401s on every call, and a real sign-in
// against a stubbed backend gets a token the API ignores — either way the browser and the
// API disagree about who is signed in. Unset until `loadAuth` resolves.
let devMode = false;

// One shared promise, so the redirect callback is handled exactly once however many
// modules ask for the session.
let authReady = null;

// ─── SESSION ─────────────────────────────────────────────────────────────────

function ensureAuth() {
  authReady ??= loadAuth();

  return authReady;
}

async function loadAuth() {
  try {
    const response = await fetch(CONFIG.apiBase + "/api/meta/auth-config");

    if (!response.ok) throw new Error(`${response.status} fetching auth config`);

    const { domain, client_id, audience, dev_mode } = await response.json();

    devMode = dev_mode;
    if (devMode) return null;

    auth0Client = await auth0.createAuth0Client({
      domain,
      clientId: client_id,
      authorizationParams: {
        audience,
        redirect_uri: window.location.origin + CALLBACK_PATH,
      },
      // A full navigation discards an in-memory cache, and re-authenticating silently
      // needs third-party cookies, which some browsers refuse.
      cacheLocation: "localstorage",
    });

    const query = window.location.search;

    if (query.includes("code=") && query.includes("state=")) {
      const { appState } = await auth0Client.handleRedirectCallback();

      window.history.replaceState({}, document.title, window.location.pathname);

      // Back to wherever Sign in was clicked. Skipped when that is already here, which
      // would be a reload loop.
      const returnTo = appState?.returnTo;
      const here = window.location.pathname + window.location.search;

      if (returnTo && returnTo !== here) window.location.replace(returnTo);
    }
  } catch (error) {
    // Public pages still load without a session.
    console.warn("Auth0 init failed:", error);
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
 * Start a sign-in, leaving the page.
 *
 * @param returnTo where to land once signed in. Defaults to the current page, which is what
 *                 a gate wants; a Sign in button that is not about this page passes its own.
 *
 * @throws when the session failed to initialise, so a caller can say so rather than leave a
 *         button that appears to do nothing.
 */
async function login(returnTo = window.location.pathname + window.location.search) {
  await ensureAuth();

  if (devMode) {
    localStorage.setItem(FAKE_SESSION_KEY, "1");
    window.location.assign(returnTo);

    return;
  }

  if (!auth0Client) {
    throw new Error("Signing in is unavailable — authentication failed to initialise.");
  }

  // The callback always lands on CALLBACK_PATH; `returnTo` is what sends them on.
  await auth0Client.loginWithRedirect({ appState: { returnTo } });
}

async function logout() {
  await ensureAuth();

  if (devMode || !auth0Client) {
    localStorage.removeItem(FAKE_SESSION_KEY);
    window.location.href = "/index.html";

    return;
  }

  await auth0Client.logout({
    logoutParams: { returnTo: window.location.origin },
  });
}

// ─── TOKEN ───────────────────────────────────────────────────────────────────

async function getToken() {
  await ensureAuth();

  if (!auth0Client && !devMode) return null;

  // `getTokenSilently` opens a hidden /authorize iframe even for a visitor with no session,
  // and an iframe that is blocked rather than refused never fires its load event — so the
  // SDK waits out its full timeout and the page appears to hang.
  if (!(await isAuthenticated())) return null;

  if (devMode) return DEV_TOKEN;

  try {
    return await auth0Client.getTokenSilently();
  } catch (error) {
    // An expired session and a missing one both end in a 401; only this line tells them
    // apart.
    console.warn("Could not get an access token:", error);

    return null;
  }
}

// ─── FETCH ───────────────────────────────────────────────────────────────────

/**
 * Call the API, carrying the bearer token when there is one.
 *
 * @param path    the path, from `/api`.
 * @param options as `fetch` takes them. A body implies JSON unless a Content-Type is set.
 *
 * @returns the parsed body, or null for a 204.
 * @throws an `Error` carrying `status`, so a caller can tell a 404 from an outage.
 */
async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = await getToken();

  if (token) headers.set("Authorization", `Bearer ${token}`);

  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(CONFIG.apiBase + path, { ...options, headers });

  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`${response.status} ${response.statusText}: ${body}`);

    error.status = response.status;

    throw error;
  }

  return response.status === 204 ? null : response.json();
}

/**
 * Call the API for something that decorates a page rather than making it possible.
 *
 * @param path     the path, from `/api`.
 * @param fallback what to return when the call fails. Omit for null.
 * @param options  as `fetch` takes them. Omit for a plain read.
 *
 * @returns the parsed body, or `fallback`. Never throws; the failure is logged here.
 */
async function apiFetchOptional(path, { fallback = null, options } = {}) {
  try {
    return await apiFetch(path, options);
  } catch (error) {
    console.error(error);

    return fallback;
  }
}

export { apiFetch, apiFetchOptional, isAuthenticated, login, logout };
