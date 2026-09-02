// Shared Tabulator formatters, sorters and the builders that make them.
//
// Table scaffolding lives in table.js; domain tables provide their own columns and rows.
// Formatters return HTML, so every dynamic value must be escaped.
//
// A `*Formatter` is passed to a column by reference. A `build*Formatter` is called first,
// with what that column needs, and returns one.

import { escapeHtml } from "../core/html.js";
import { SUITES, taskLabel } from "../core/suites.js";
import { formatDate, score } from "../core/utils.js";
import {
  buildMetricBadge,
  buildMetricBadgeList,
  buildMineBadge,
  buildPretrainedBadge,
  buildRoleBadge,
  buildStatusBadge,
  buildSuiteBadgeList,
} from "../components/badges.js";
import { buildIcon, getIcon } from "../components/icons.js";

// ─── VALUES ──────────────────────────────────────────────────────────────────

const EMPTY_VALUE = "—";

function emptyMetadata() {
  return `<span class="metadata">${EMPTY_VALUE}</span>`;
}

const MEDAL_CLASSES = {
  1: "rank-gold",
  2: "rank-silver",
  3: "rank-bronze",
};

function rankBadge(rank) {
  if (rank == null) return emptyMetadata();

  const medalClass = MEDAL_CLASSES[rank];

  return medalClass
    ? `<span class="${medalClass}">${escapeHtml(rank)}</span>`
    : String(rank);
}

/**
 * @param stacked the spread on its own line under the value, for a cell too narrow to hold
 *                both on one — the compare grid gives a task an eighth of the page.
 */
function buildMeanSem(mean, sem, { stacked = false } = {}) {
  if (mean == null) return emptyMetadata();

  const value = `<span class="value">${escapeHtml(score(mean))}</span>`;

  if (sem == null) return value;

  const spread = `<span class="metadata">± ${escapeHtml(score(sem))}</span>`;

  return stacked
    ? `<span class="column gap-xs right">${value}${spread}</span>`
    : `${value} ${spread}`;
}

function taskLinkAttributes(row) {
  return `
    href="#"
    data-view="task"
    data-task="${escapeHtml(row.id)}"
  `;
}

// ─── SORTERS ─────────────────────────────────────────────────────────────────
//
// Tabulator swaps the two rows for a descending sort rather than negating what a sorter
// returns — `a = "asc" == dir ? first : second` — so a sorter always compares as if
// ascending. Which also means a sorter with a fixed idea of where empties go has to undo
// that swap itself, and that is the whole reason `valueSorter` takes `dir`.

/**
 * A comparison over values that may be missing.
 *
 * @param compare   (a, b) => the ascending order of two present values.
 * @param emptyLast the missing at the bottom of the table whichever way it is sorted. For a
 *                  column where absence is not a low value but a different kind of answer —
 *                  an unranked model hasn't placed below the others so much as not competed,
 *                  and an unscored task isn't a score of zero. Omit and the missing sort as
 *                  the smallest, which is Tabulator's own habit.
 * @returns a Tabulator sorter.
 */
function valueSorter(compare, { emptyLast = false } = {}) {
  return (a, b, aRow, bRow, column, dir) => {
    const missing = emptyLast && dir === "desc" ? -1 : 1;

    if (a == null && b == null) return 0;
    if (a == null) return emptyLast ? missing : -1;
    if (b == null) return emptyLast ? -missing : 1;

    return compare(a, b);
  };
}

const ascending = (a, b) => a - b;

// Numbers, the missing sorting as the smallest — a plain count or a size, where nothing to
// show and the least of it read the same way.
const numericSorter = valueSorter(ascending);

// A rank, or any figure where nothing to show is not the least of it.
const rankSorter = valueSorter(ascending, { emptyLast: true });

// A `{ mean, sem }` cell — the score tables and the comparison grids hold the whole object so
// that both halves print from one field.
const meanSorter = valueSorter(
  (a, b) => a.mean - b.mean,
  { emptyLast: true },
);

function dateSorter(a, b) {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;

  return a < b ? -1 : a > b ? 1 : 0;
}

function sortSuites(suites = []) {
  return SUITES.filter((suite) => suites.includes(suite));
}

// ─── BUILDERS ────────────────────────────────────────────────────────────────

/**
 * A formatter linking each row to its own page.
 *
 * @param page       the page the link goes to; the row id becomes its `?id=`.
 * @param labelField the row field the link text comes from.
 * @param idField    the row field holding the id. Defaults to "id".
 *
 * @returns a Tabulator formatter.
 */
function buildLinkFormatter(page, labelField, idField = "id") {
  return (cell) => {
    const row = cell.getData();

    return `
      <a href="${page}?id=${encodeURIComponent(row[idField])}">
        ${escapeHtml(row[labelField] ?? EMPTY_VALUE)}
      </a>
    `;
  };
}

/**
 * A formatter putting a model's name, its link and its badges in one cell.
 *
 * @param page     the model page the name links to.
 * @param showMine mark the rows on the viewer's own teams. Omit on a listing that is
 *                 entirely theirs, where it would say nothing.
 *
 * @returns a Tabulator formatter.
 */
function buildModelNameFormatter(page, { showMine = false } = {}) {
  const link = buildLinkFormatter(page, "name");

  return (cell) => {
    const row = cell.getData();

    const badges = [
      buildPretrainedBadge(row.is_pretrained, "sm"),
      showMine ? buildMineBadge(row.is_mine, "sm") : "",
    ].join("");

    return `<span class="row left gap-sm">${link(cell)}${badges}</span>`;
  };
}

/**
 * A formatter showing a mean with its spread, and optionally the metric it was measured in.
 *
 * @param semField    the row field holding the standard error.
 * @param metricField the row field naming the metric, shown as a badge beside the value.
 *                    Omit where every row shares one metric.
 *
 * @returns a Tabulator formatter.
 */
function buildScoreSemFormatter(semField, { metricField = null } = {}) {
  return (cell) => {
    const row = cell.getData();

    const value = buildMeanSem(cell.getValue(), row[semField]);

    if (!metricField || !row[metricField]) {
      return value;
    }

    return `
      <span class="row left gap-sm">
        <span>${value}</span>
        ${buildMetricBadge(row[metricField], "sm")}
      </span>
    `;
  };
}

/**
 * A formatter putting the row's suite badge in front of another formatter's output.
 *
 * @param inner the formatter drawing the rest of the cell.
 *
 * @returns a Tabulator formatter.
 */
function buildTaskSuiteFormatter(inner) {
  return (cell) => {
    const suite = cell.getData().suite;

    return `
      <span class="row left gap-md">
        ${suite ? buildSuiteBadgeList([suite], "sm") : ""}
        ${inner(cell)}
      </span>
    `;
  };
}

// ─── FORMATTERS ──────────────────────────────────────────────────────────────

function metadataFormatter(cell) {
  return `<span class="metadata">${escapeHtml(cell.getValue() ?? EMPTY_VALUE)}</span>`;
}

function dateFormatter(cell) {
  return `<span class="metadata">${escapeHtml(formatDate(cell.getValue()))}</span>`;
}

function modelFormatter(cell) {
  const row = cell.getData();

  const badges = [
    buildPretrainedBadge(row.isPretrained, "sm"),
    buildMineBadge(row.isMine, "sm"),
  ].join("");

  return `
    <a
      href="/html/models/models.html?id=${encodeURIComponent(row.modelId)}"
      class="column"
    >
      <span class="row left gap-sm">
        <span class="label">${escapeHtml(row.model_name)}</span>
        ${badges}
      </span>
      <span class="metadata">${escapeHtml(row.team_name)}</span>
    </a>
  `;
}

// Takes either the array a model or submission row carries, or the single suite on a task
// row.
function suiteBadgesFormatter(cell) {
  const value = cell.getValue();
  const suites = Array.isArray(value) ? value : value == null ? [] : [value];

  return suites.length
    ? `<span class="row left gap-sm">${buildSuiteBadgeList(suites, "sm")}</span>`
    : EMPTY_VALUE;
}

function metricsBadgeFormatter(cell) {
  const value = cell.getValue();
  const metrics = Array.isArray(value) ? value : value == null ? [] : [value];

  return metrics.length ? buildMetricBadgeList(metrics) : EMPTY_VALUE;
}

function taskNameFormatter(cell) {
  const value = cell.getValue();

  return value
    ? `<span class="label">${escapeHtml(taskLabel(value))}</span>`
    : EMPTY_VALUE;
}

function statusFormatter(cell) {
  return buildStatusBadge(cell.getValue(), "sm");
}

function roleBadgeFormatter(cell) {
  return buildRoleBadge(cell.getValue(), "sm") || EMPTY_VALUE;
}

function taskLinkFormatter(cell) {
  const row = cell.getData();
  const taskId = row.task_id;

  return `
    <a ${taskLinkAttributes(row)}>
      ${escapeHtml(taskId ? taskLabel(taskId) : EMPTY_VALUE)}
    </a>
  `;
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
      : emptyMetadata();
  }

  return value == null || value === ""
    ? emptyMetadata()
    : `<span class="metadata">${escapeHtml(value)}</span>`;
}

function rankFormatter(cell) {
  return rankBadge(cell.getValue());
}

function rankUsageFormatter(cell) {
  const used = cell.getValue();

  const icons = [
    used?.public &&
      buildIcon("public", {
        className: "rank-icon public",
        title: "Counted in the public ranking",
      }),

    used?.private &&
      buildIcon("private", {
        className: "rank-icon private",
        title: "Counted in the private ranking",
      }),
  ].filter(Boolean);

  if (!icons.length) return emptyMetadata();

  return `
    <span class="row left gap-sm">
      ${icons.join(`<span class="metadata">and</span>`)}
    </span>
  `;
}

// The compare grid's cells, where a task holds an eighth of the page: the spread goes under
// the value rather than beside it.
function meanSemFormatter(cell) {
  const value = cell.getValue();

  return buildMeanSem(value?.mean ?? null, value?.sem ?? null, {
    stacked: true,
  });
}

function diffFormatter(cell) {
  const diff = cell.getValue()?.mean;

  if (diff == null) return emptyMetadata();

  const direction = diff > 0 ? "diff-up" : diff < 0 ? "diff-down" : "diff-flat";

  const sign = diff > 0 ? "+" : "";

  return `
    <span class="${direction}">
      ${sign}${escapeHtml(score(diff))}
    </span>
  `;
}

export {
  buildLinkFormatter,
  buildMeanSem,
  buildModelNameFormatter,
  buildScoreSemFormatter,
  buildTaskSuiteFormatter,
  dateFormatter,
  dateSorter,
  diffFormatter,
  editFormatter,
  meanSemFormatter,
  meanSorter,
  metadataFormatter,
  metricsBadgeFormatter,
  modelFormatter,
  numericSorter,
  parameterFormatter,
  rankBadge,
  rankFormatter,
  rankSorter,
  rankUsageFormatter,
  roleBadgeFormatter,
  sortSuites,
  statusFormatter,
  valueSorter,
  suiteBadgesFormatter,
  taskLinkAttributes,
  taskLinkFormatter,
  taskNameFormatter,
};
