import {escapeHtml} from "../core/utils.js";
import {SUITES} from "../core/suites.js";

function statusBadgeClass(status) {
  return { done: "success", scoring: "pending", failed: "error", pending: "pending" }[status] ?? "";
}


function buildSuiteBadgeList(suites) {
  return suites
    .map(suite => `<span class="badge sm ${escapeHtml(suite)}">${escapeHtml(suite.toUpperCase())}</span>`)
    .join("");
}


function buildSuiteCoverageBadges(suites) {
  const covered = new Set(suites);

  return SUITES
    .map(suite => {
      // `suite` is from our own SUITES, so the class is safe either way; escaped for
      // the same uniformity as everywhere else in this file.
      const variant = covered.has(suite) ? escapeHtml(suite) : "neutral";

      return `<span class="badge sm ${variant}">${escapeHtml(suite.toUpperCase())}</span>`;
    })
    .join("");
}

function buildStatusBadge(status) {
  return `<span class="badge sm ${statusBadgeClass(status)}">${escapeHtml(status)}</span>`;
}


// Owner is the role that grants something — renaming the team, and being the member who
// can't be removed while they're the last one — so it carries the emphasis and every
// other role reads neutral. A team with no role at all (a non-member viewing a team, or
// a listing that didn't ask) renders nothing rather than an empty badge.
function roleBadgeClass(role) {
  return role === "owner" ? "success" : "neutral";
}

function buildRoleBadge(role) {
  if (!role) return "";

  return `<span class="badge sm ${roleBadgeClass(role)}">${escapeHtml(role)}</span>`;
}

export {
  buildSuiteBadgeList,
  buildStatusBadge,
  buildSuiteCoverageBadges,
  buildRoleBadge
}