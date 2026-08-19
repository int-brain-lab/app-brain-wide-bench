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
import { SUITES, suiteFromTask } from "../core/suites.js";
import { buildRoleBadge, buildStatusBadge, buildSuiteBadgeList } from "../components/badges.js";


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
  return `<span class="row left gap-sm">${buildSuiteBadgeList(cell.getValue() ?? [])}</span>`;
}

// Singular counterpart, for a row belonging to exactly one suite (a task) rather than
// covering several (a submission, a model).
function suiteBadgeFormatter(cell) {
  const suite = cell.getValue();

  return suite ? buildSuiteBadgeList([suite]) : "—";
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

  const badges = metrics
    .map(metric => `<span class="badge metric">${escapeHtml(metric)}</span>`)
    .join("");

  return `<span class="row left gap-sm">${badges}</span>`;
}

function scoreFormatter(cell) {
  return score(cell.getValue());
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
  return buildStatusBadge(cell.getValue());
}


// ─── TEAMS ──────────────────────────────────────────────────────────────────

// buildRoleBadge renders nothing without a role, which on a listing of every team is most
// rows — so the em dash stands in, as it does for any other empty cell.
function roleBadgeFormatter(cell) {
  return buildRoleBadge(cell.getValue()) || "—";
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
      <i class="btn-icon" data-lucide="pencil"></i>
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

// Its own list because a bar needs a colour class, which the metric options don't carry.
const SUITE_BARS = SUITES.map(suite => ({ key: suite, label: suite.toUpperCase(), cls: suite }));

function rankFormatter(cell) {
  const rank = cell.getValue();
  const medal = MEDAL_CLASSES[rank];

  return medal ? `<span class="${medal}">${escapeHtml(rank)}</span>` : String(rank ?? "");
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

// Curried on the getter, not the metric: the column definition holds this formatter for the
// life of the table, while the metric changes under it. All three suites while ranking by
// Overall, otherwise just the suite the ranked task belongs to.
function suiteBarsFormatter(getMetric) {
  return cell => {
    const row = cell.getData();
    const metric = getMetric();
    const bars = metric === "overall"
      ? SUITE_BARS
      : SUITE_BARS.filter(bar => bar.key === suiteFromTask(metric));

    return `<div class="column gap-sm">${bars.map(bar => {
      const percent = row[bar.key] == null ? 0 : Math.round(row[bar.key] * 100);

      return `
        <div class="row gap-sm">
          <span class="metadata">${escapeHtml(bar.label)}</span>
          <div class="bar-track">
            <div class="bar ${escapeHtml(bar.cls)}" style="width:${percent}%"></div>
          </div>
        </div>
      `;
    }).join("")}</div>`;
  };
}


export {
  score,
  numericSorter,
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
  roleBadgeFormatter,
  statusFormatter,
  taskLinkAttributes,
  taskLinkFormatter,
  editFormatter,
  parameterFormatter,
  rankFormatter,
  modelFormatter,
  suiteBarsFormatter,
};
