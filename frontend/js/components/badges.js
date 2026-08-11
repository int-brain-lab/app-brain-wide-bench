import {escapeHtml} from "../utils.js";
import {SUITES} from "../utils/suites.js";

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

export {
  buildSuiteBadgeList,
  buildStatusBadge,
  buildSuiteCoverageBadges
}