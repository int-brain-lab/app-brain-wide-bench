import { apiFetch, apiFetchOptional } from "./client.js";
import { normalizeObject, trimmed } from "../core/validation.js";

// ─── PAYLOADS ────────────────────────────────────────────────────────────────

function buildUserPayload(state) {
  return normalizeObject(state, { name: trimmed });
}

// ─── API ─────────────────────────────────────────────────────────────────────

async function loadMe() {
  return await apiFetch("/api/users/me");
}

async function updateMe(patch) {
  return await apiFetch("/api/users/me", {
    method: "PATCH",
    body: JSON.stringify(buildUserPayload(patch)),
  });
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

export { loadMe, updateMe, searchUsers };
