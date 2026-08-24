// Every cell renderer and column sorter the tables use, in one place — table.js has the
// scaffolding and each domain table has its rows, columns and controls, and several of
// these are shared across tables with nothing else in common.
//
// Tabulator inserts a formatter's returned string as HTML, so every formatter here is an
// innerHTML sink and model names, labels, team names and affiliations are all user-supplied
// — hence escapeHtml on every interpolation.
//
// A formatter reads its cell through `getValue()` / `getData()` only: renderStaticTable
// fakes a cell with exactly those two methods, so anything reaching for cell.getElement()
// would work in one renderer and not the other.

import { escapeHtml, formatDate } from "../core/utils.js";
import { getIcon } from "../components/icons.js";
import { SUITES } from "../core/suites.js";
import {
  buildMetricBadgeList,
  buildRoleBadge,
  buildStatusBadge,
  buildSuiteBadgeList,
} from "../components/badges.js";


// ─── VALUES ─────────────────────────────────────────────────────────────────

function score(value) {
  return value == null ? "—" : value.toFixed(3);
}


// ─── SORTERS ────────────────────────────────────────────────────────────────

// Tabulator's built-in "number" sorter leaves a null wherever the browser's comparison
// lands it. Nulls sort smallest here, so under the desc sort these columns use, "no score"
// ends up last rather than interleaved with real ones.
function numericSorter(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;

  return a - b;
}

// A rank column inverts both of numericSorter's assumptions: smaller is better, and absent
// is *worst* rather than smallest — an unranked model floated to the top of an ascending
// sort would read as leading the board. `rankOrder` is the bare comparison, so a plain sort
// elsewhere can order by position without going through Tabulator.
function rankOrder(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;

  return a - b;
}

// Tabulator applies the sort direction itself, so this is written for ascending — the only
// direction a rank is normally read in. Clicking the header to descending does put the
// unranked rows first, which is the honest consequence of one comparator per column.
function rankSorter(a, b) {
  return rankOrder(a, b);
}

// Tabulator's built-in "datetime" sorter needs luxon, which this app doesn't load. ISO 8601
// strings already order correctly under a plain comparison; a missing date sorts smallest,
// which puts those rows last under a desc sort.
function dateSorter(a, b) {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}


// ─── GENERAL ────────────────────────────────────────────────────────────────

// Curried on the page rather than taking a full href, so a caller can't pass an unencoded
// id — it always goes through encodeURIComponent here.
function linkFormatter(page, labelField, idField = "id") {
  return cell => {
    const row = cell.getData();

    return `<a href="${page}?id=${encodeURIComponent(row[idField])}">${escapeHtml(row[labelField])}</a>`;
  };
}

function metadataFormatter(cell) {
  return `<span class="metadata">${escapeHtml(cell.getValue() ?? "—")}</span>`;
}

function dateFormatter(cell) {
  return `<span class="metadata">${escapeHtml(formatDate(cell.getValue()))}</span>`;
}


// ─── SUITES ─────────────────────────────────────────────────────────────────

function suiteBadgesFormatter(cell) {
  return `<span class="row left gap-sm">${buildSuiteBadgeList(cell.getValue() ?? [], "sm")}</span>`;
}

// Singular counterpart, for a row belonging to exactly one suite (a task) rather than
// covering several (a submission, a model).
function suiteBadgeFormatter(cell) {
  const suite = cell.getValue();

  return suite ? buildSuiteBadgeList([suite], "sm") : "—";
}

// SUITES order rather than discovery order, so the badges line up down the column.
function sortSuites(suites) {
  return SUITES.filter(suite => suites.includes(suite));
}


// ─── METRICS AND SCORES ─────────────────────────────────────────────────────

// Takes a single name or an array: a task row carries just its primary metric today, but
// TaskScoreOut also has a `metrics` dict, so a cell showing several needs no new formatter.
function metricsBadgeFormatter(cell) {
  const value = cell.getValue();
  const metrics = Array.isArray(value) ? value : value == null ? [] : [value];

  if (metrics.length === 0) return "—";

  return buildMetricBadgeList(metrics);
}

function scoreFormatter(cell) {
  return score(cell.getValue());
}

// A task name that links to the per-recording, per-metric breakdown of its score. The
// breakdown lives on the submission record page, so the link carries a full URL *and* the
// router's `data-view`: the URL is what makes it work from the dashboard and the model page,
// where there is no `score` view to route to, and the attributes are what keep it a
// client-side navigation on the submission page itself (see the unknown-view fall-through in
// router.js).
//
// A row with no score has nothing to break down, and one with no submission has nowhere to
// go, so both render as the plain name — the same markup taskNameFormatter gives.
function taskScoreLinkFormatter(cell) {
  const row = cell.getData();
  const name = escapeHtml(cell.getValue());

  if (row.mean_score == null || row.submission_id == null) {
    return `<span class="label">${name}</span>`;
  }

  const query = new URLSearchParams({ id: row.submission_id, view: "score", score: row.id });

  return `
    <a href="/html/submissions/submissions.html?${query}"
       data-view="score"
       data-score="${escapeHtml(row.id)}">${name}</a>
  `;
}

// score() already renders a missing value as "—", which shouldn't carry a ±.
function semFormatter(cell) {
  const value = cell.getValue();

  return value == null
    ? `<span class="metadata">—</span>`
    : `<span class="metadata">± ${score(value)}</span>`;
}

function taskNameFormatter(cell) {
  return `<span class="label">${escapeHtml(cell.getValue())}</span>`;
}


// ─── SUBMISSIONS ────────────────────────────────────────────────────────────

function statusFormatter(cell) {
  return buildStatusBadge(cell.getValue(), "sm");
}


// ─── TEAMS ──────────────────────────────────────────────────────────────────

// buildRoleBadge renders nothing without a role, which on a listing of every team is most
// rows — so the em dash stands in, as it does for any other empty cell.
function roleBadgeFormatter(cell) {
  return buildRoleBadge(cell.getValue(), "sm") || "—";
}


// ─── TASK SUBMISSIONS ───────────────────────────────────────────────────────

// Not an href: these rows only ever render inside the submission record page, so they
// route through it. `data-task` is the declared view param the router copies from the
// link's dataset into the URL.
function taskLinkAttributes(row) {
  return `href="#" data-view="task" data-task="${escapeHtml(row.id)}"`;
}

function taskLinkFormatter(cell) {
  const row = cell.getData();

  return `<a ${taskLinkAttributes(row)}>${escapeHtml(row.task_id)}</a>`;
}

function editFormatter(cell) {
  return `
    <a class="btn with-icon" ${taskLinkAttributes(cell.getData())}>
      <i class="btn-icon" data-lucide="${getIcon("edit")}"></i>
      Edit
    </a>
  `;
}

function parameterFormatter(cell) {
  const value = cell.getValue();

  if (Array.isArray(value)) {
    return value.length
      ? `<span class="metadata">${escapeHtml(value.join(", "))}</span>`
      : `<span class="metadata">—</span>`;
  }

  return value == null || value === ""
    ? `<span class="metadata">—</span>`
    : `<span class="metadata">${escapeHtml(value)}</span>`;
}


// ─── LEADERBOARD ────────────────────────────────────────────────────────────

const MEDAL_CLASSES = { 1: "rank-gold", 2: "rank-silver", 3: "rank-bronze" };

// A null rank is a model that hasn't placed — partial coverage on the overall figure, or no
// score for the task being ranked. An em dash rather than an empty cell, so the row reads as
// deliberately unranked instead of broken.
function rankFormatter(cell) {
  const rank = cell.getValue();

  if (rank == null) return `<span class="metadata">—</span>`;

  const medal = MEDAL_CLASSES[rank];

  return medal ? `<span class="${medal}">${escapeHtml(rank)}</span>` : String(rank);
}

function modelFormatter(cell) {
  const row = cell.getData();

  return `
    <a href="/html/models/models.html?id=${encodeURIComponent(row.modelId)}" class="column">
      <div class="label">${escapeHtml(row.title)}</div>
      <div class="metadata">${escapeHtml(row.affiliation)}</div>
    </a>
  `;
}

// How a rank is written wherever one appears — a suite column, a task column, the average
// across all of them. Two decimals because these are means over recordings, so "2.00" and
// "2.14" are a real distinction and trimming it would hide the thing the averaging is for.
function rankValue(value) {
  return value == null
    ? `<span class="metadata">—</span>`
    : `<span class="rank-value">${escapeHtml(value.toFixed(2))}</span>`;
}


// ─── COMPARISON ─────────────────────────────────────────────────────────────

// The comparison grids put a whole { mean, sem, metric } object in each task cell rather
// than a bare number, so these read the half they want off the value. Both sorters go
// through numericSorter, which is what keeps an unscored task last under a desc sort.

function compareScoreSorter(a, b) {
  return numericSorter(a?.mean ?? null, b?.mean ?? null);
}

function diffSorter(a, b) {
  return numericSorter(a?.diff ?? null, b?.diff ?? null);
}

// "0.612 ± 0.014", with the spread in metadata type so a column of them reads as one
// number each. A scored task with a single seed has a mean and no sem, and shows the mean
// alone rather than "± —".
function meanSemFormatter(cell) {
  const value = cell.getValue();

  if (value?.mean == null) return `<span class="metadata">—</span>`;

  const spread = value.sem == null
    ? ""
    : ` <span class="metadata">± ${escapeHtml(score(value.sem))}</span>`;

  return `<span class="value">${escapeHtml(score(value.mean))}</span>${spread}`;
}

// A signed difference against the baseline model. The sign is explicit on a gain — a column
// mixing "0.04" and "-0.04" makes the reader supply the plus themselves — and coloured,
// because which direction is better is the one thing the grid is for.
function diffFormatter(cell) {
  const value = cell.getValue();

  if (value?.diff == null) return `<span class="metadata">—</span>`;

  const direction = value.diff > 0 ? "diff-up" : value.diff < 0 ? "diff-down" : "diff-flat";
  const sign = value.diff > 0 ? "+" : "";

  return `<span class="${direction}">${sign}${escapeHtml(score(value.diff))}</span>`;
}

// The task with the metric it is scored in, for a grid where the metric has no column of
// its own. Under the name rather than beside it: the ids run to twenty-five characters and
// a badge on the same line sets the column's width from the longest pair rather than the
// longest name. It also gives the row the same two-line shape as the model headers above.
//
// The metric still has to be a field on the row — it is what the select above the grid
// filters on — it just has nowhere of its own to appear.
function taskMetricFormatter(cell) {
  const metric = cell.getData().metric;

  const badge = metric ? buildMetricBadgeList([metric]) : "";

  return `
    <span class="column gap-xs">
      <span class="label">${escapeHtml(cell.getValue())}</span>
      ${badge}
    </span>
  `;
}


export {
  score,
  numericSorter,
  rankOrder,
  rankSorter,
  dateSorter,
  linkFormatter,
  metadataFormatter,
  dateFormatter,
  suiteBadgesFormatter,
  suiteBadgeFormatter,
  sortSuites,
  metricsBadgeFormatter,
  scoreFormatter,
  semFormatter,
  taskNameFormatter,
  taskScoreLinkFormatter,
  roleBadgeFormatter,
  statusFormatter,
  taskLinkAttributes,
  taskLinkFormatter,
  editFormatter,
  parameterFormatter,
  rankFormatter,
  modelFormatter,
  rankValue,
  compareScoreSorter,
  diffSorter,
  meanSemFormatter,
  diffFormatter,
  taskMetricFormatter,
};
