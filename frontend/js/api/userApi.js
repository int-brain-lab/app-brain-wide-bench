import { apiFetch, apiFetchOptional, isAuthenticated } from "./client.js";
import { normalizeObject, trimmed } from "../core/validation.js";

// ─── PAYLOADS ────────────────────────────────────────────────────────────────

function buildUserPayload(state) {
  return normalizeObject(state, { name: trimmed });
}

// ─── API ─────────────────────────────────────────────────────────────────────

// Memoised per page load; a full navigation discards it.
let cached = null;
let inflight = null;

async function loadMe() {
  if (cached) return cached;

  // Held locally: `inflight` is cleared below, and a second caller awaiting it by then
  // would resolve to null.
  const request = (inflight ??= apiFetch("/api/users/me"));

  try {
    cached = await request;
  } finally {
    // A rejected promise left here would be re-awaited by every later call.
    inflight = null;
  }

  return cached;
}

// The viewer, or null with no session and on failure.
async function getCurrentUser() {
  try {
    if (!(await isAuthenticated())) return null;

    return await loadMe();
  } catch (error) {
    console.error(error);

    return null;
  }
}

async function updateMe(patch) {
  // Written through: fillSidebarUser() re-reads straight after a save.
  cached = await apiFetch("/api/users/me", {
    method: "PATCH",
    body: JSON.stringify(buildUserPayload(patch)),
  });

  return cached;
}

// Find a user by their exact email, for the member picker. Exact and email-only by
// design: a substring lookup would let any signed-in user walk the directory, and
// matching on display names would let someone take a colleague's name and surface in
// searches meant for them. So this is a picker, not a way to browse.
//
// Returns [] on failure rather than throwing: the search runs on every keystroke, and a
// transient error shouldn't put an error banner under a field the user is still typing
// in. An empty result reads the same as "no matches", which is the honest fallback.
async function searchUsers(query, limit = 10) {
  const params = new URLSearchParams({ q: query, limit: String(limit) });

  return await apiFetchOptional(`/api/users?${params}`, { fallback: [] });
}

export { getCurrentUser, loadMe, searchUsers, updateMe };
