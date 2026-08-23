import {escapeHtml} from "../core/utils.js";
import {SUITES} from "../core/suites.js";
import { buildIcon } from "./icons.js";

function statusBadgeClass(status) {
  return { done: "success", scoring: "pending", failed: "error", pending: "pending" }[status] ?? "";
}


function buildSuiteBadgeList(suites, size="") {
  const badges = suites
    .map(suite => `<span class="badge ${size} ${escapeHtml(suite)}">${escapeHtml(suite.toUpperCase())}</span>`)
    .join("");
  
  return `<span class="row left gap-sm">${badges}</span>`;
}


// The metric a score is measured in. Same shape as buildSuiteBadgeList, and shared for the
// same reason: it appears as a column of its own on one grid and folded into the task label
// on another, and the two had already drifted a size apart.
function buildMetricBadgeList(metrics, size="") {
  const badges = metrics
    .map(metric => `<span class="badge ${size} metric">${escapeHtml(metric)}</span>`)
    .join("");

  return `<span class="row left gap-sm">${badges}</span>`;
}


function buildSuiteCoverageBadges(suites, size="") {
  const covered = new Set(suites);

  return SUITES
    .map(suite => {
      // `suite` is from our own SUITES, so the class is safe either way; escaped for
      // the same uniformity as everywhere else in this file.
      const variant = covered.has(suite) ? escapeHtml(suite) : "neutral";

      return `<span class="badge ${size} ${variant}">${escapeHtml(suite.toUpperCase())}</span>`;
    })
    .join("");
}

function buildStatusBadge(status, size="") {
  return `<span class="badge ${size} ${statusBadgeClass(status)}">${escapeHtml(status)}</span>`;
}


// Owner is the role that grants something — renaming the team, and being the member who
// can't be removed while they're the last one — so it carries the emphasis and every
// other role reads neutral. A team with no role at all (a non-member viewing a team, or
// a listing that didn't ask) renders nothing rather than an empty badge.
function roleBadgeClass(role) {
  return role === "owner" ? "success" : "neutral";
}

function buildRoleBadge(role, size="") {
  if (!role) return "";

  return `<span class="badge ${size} ${roleBadgeClass(role)}">${escapeHtml(role)}</span>`;
}


// Whether anyone can read the record. Null *or* undefined renders nothing: a list row that
// never carried the field says nothing about visibility, which is different from saying it
// is private — and the two branches below both make a claim.
//
// The icon's concept is the same word as the badge's modifier class, so there is one
// decision here rather than three that could disagree.
function buildVisibleBadge(visible, size = "") {
  if (visible == null) return "";

  const state = visible ? "public" : "private";

  return `
    <span class="badge ${size} visible">
      ${buildIcon(state, { className: "field-icon" })}
      ${visible ? "Public" : "Private"}
    </span>
  `;
}


export {
  buildSuiteBadgeList,
  buildMetricBadgeList,
  buildStatusBadge,
  buildSuiteCoverageBadges,
  buildRoleBadge,
  buildVisibleBadge
}