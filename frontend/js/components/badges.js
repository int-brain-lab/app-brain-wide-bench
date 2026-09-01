import { escapeHtml } from "../core/html.js";
import { suiteLabel, SUITES } from "../core/suites.js";
import { buildIcon } from "./icons.js";

function statusBadgeClass(status) {
  return (
    {
      done: "success",
      scoring: "pending",
      failed: "error",
      pending: "pending",
    }[status] ?? ""
  );
}

// Nothing at all for an empty list, rather than an empty wrapper: the wrapper still counts
// as a flex item, so it consumes one of its parent's gaps and indents whatever follows it —
// a pretrained pill on a model with no suites yet. It is also what lets buildBadges' filter
// drop a record with no suites instead of joining a bare row, as its comment intends.
function buildSuiteBadge(suite, size = "") {
  return `<span class="badge ${size} ${escapeHtml(suite)}">${escapeHtml(suiteLabel(suite))}</span>`;
}

// One badge and a list of them are separate calls for the reason buildMetricBadge gives: the
// list is a flex row, which is a block, and a caller putting one badge *beside* something on
// one line needs it without the row around it.
function buildSuiteBadgeList(suites, size = "") {
  if (!suites.length) return "";

  const badges = suites.map((suite) => buildSuiteBadge(suite, size)).join("");

  return `<span class="row left gap-sm">${badges}</span>`;
}

// The metric a score is measured in. Same shape as buildSuiteBadgeList, and shared for the
// same reason: it appears as a column of its own on one grid and folded into another cell
// elsewhere, and the copies had already drifted a size apart.
//
// One badge and a list of them are separate calls because the list is a flex row, which is
// a block: a caller putting a single badge *beside* something on one line needs the badge
// without the row around it.
function buildMetricBadge(metric, size = "") {
  return `<span class="badge ${size} metric">${escapeHtml(metric)}</span>`;
}

function buildMetricBadgeList(metrics, size = "") {
  return `<span class="row left gap-sm">${metrics.map((metric) => buildMetricBadge(metric, size)).join("")}</span>`;
}

function buildSuiteCoverageBadges(suites, size = "") {
  const covered = new Set(suites);

  return SUITES.map((suite) => {
    // `suite` is from our own SUITES, so the class is safe either way; escaped for
    // the same uniformity as everywhere else in this file.
    const variant = covered.has(suite) ? escapeHtml(suite) : "neutral";

    return `<span class="badge ${size} ${variant}">${escapeHtml(suiteLabel(suite))}</span>`;
  }).join("");
}

function buildStatusBadge(status, size = "") {
  return `<span class="badge ${size} ${statusBadgeClass(status)}">${escapeHtml(status)}</span>`;
}

// Owner is the role that grants something — renaming the team, and being the member who
// can't be removed while they're the last one — so it carries the emphasis and every
// other role reads neutral. A team with no role at all (a non-member viewing a team, or
// a listing that didn't ask) renders nothing rather than an empty badge.
function roleBadgeClass(role) {
  return role === "owner" ? "success" : "neutral";
}

function buildRoleBadge(role, size = "") {
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

// A record on one of the viewer's own teams, for a listing that mixes theirs with everyone
// else's. `success` rather than the neutral grey the other pills here use: this is the one
// badge about the *reader* rather than about the record, and on a row that may already carry
// a grey pill a second one would be indistinguishable at a glance.
//
// Only the positive case, and only where the caller asked: a listing that is entirely the
// viewer's own — the dashboard, "My models" — would badge every row and say nothing.
function buildMineBadge(isMine, size = "") {
  if (!isMine) return "";

  return `<span class="badge ${size} success">Yours</span>`;
}

// A pretrained foundation model, as against one trained from scratch on every session.
// Only the positive case earns a badge: training from scratch is the ordinary shape for a
// single-session baseline, so a badge on every one of those would carry no information —
// and a null is a model whose pretraining fields were never filled in, which is not a
// claim either way. So false and null both render nothing.
function buildPretrainedBadge(isPretrained, size = "") {
  if (!isPretrained) return "";

  return `<span class="badge ${size} neutral">Pretrained</span>`;
}

export {
  buildSuiteBadge,
  buildSuiteBadgeList,
  buildMetricBadge,
  buildMetricBadgeList,
  buildStatusBadge,
  buildSuiteCoverageBadges,
  buildRoleBadge,
  buildVisibleBadge,
  buildPretrainedBadge,
  buildMineBadge,
};
