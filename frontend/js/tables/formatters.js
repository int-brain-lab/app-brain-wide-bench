// Shared Tabulator formatters, sorters and the builders that make them.
//
// Table scaffolding lives in table.js; domain tables provide their own columns and rows.
// Formatters return HTML, so every dynamic value must be escaped.
//
// A `*Formatter` is passed to a column by reference. A `build*Formatter` is called first,
// with what that column needs, and returns one.

import { escapeHtml } from "../core/html.js";
import { SUITES } from "../core/suites.js";
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

function rankValue(value) {
  return value == null
    ? emptyMetadata()
    : `<span class="rank-value">${escapeHtml(value.toFixed(2))}</span>`;
}

function buildMeanSem(mean, sem) {
  if (mean == null) return emptyMetadata();

  const spread =
    sem == null
      ? ""
      : ` <span class="metadata">± ${escapeHtml(score(sem))}</span>`;

  return `<span class="value">${escapeHtml(score(mean))}</span>${spread}`;
}

function taskLinkAttributes(row) {
  return `
    href="#"
    data-view="task"
    data-task="${escapeHtml(row.id)}"
  `;
}

// ─── SORTERS ─────────────────────────────────────────────────────────────────

function numericSorter(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;

  return a - b;
}

function dateSorter(a, b) {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;

  return a < b ? -1 : a > b ? 1 : 0;
}

function rankOrder(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;

  return a - b;
}

function compareScoreSorter(a, b) {
  return numericSorter(a?.mean ?? null, b?.mean ?? null);
}

// A difference is a `{ mean, sem }` like a score is — the grid and the chart are handed the
// same cell, from the same mode in compareData. Its sem is always null: the spread of a
// difference is not either model's.
function diffSorter(a, b) {
  return numericSorter(a?.mean ?? null, b?.mean ?? null);
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

function scoreFormatter(cell) {
  return score(cell.getValue());
}

function taskNameFormatter(cell) {
  const value = cell.getValue();

  return value
    ? `<span class="label">${escapeHtml(value.slice(4))}</span>`
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
      ${escapeHtml(taskId ? taskId.slice(4) : EMPTY_VALUE)}
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

function meanSemFormatter(cell) {
  const value = cell.getValue();

  return buildMeanSem(value?.mean ?? null, value?.sem ?? null);
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
  buildLinkFormatter,
  buildMeanSem,
  buildModelNameFormatter,
  buildScoreSemFormatter,
  buildTaskSuiteFormatter,
  compareScoreSorter,
  dateFormatter,
  dateSorter,
  diffFormatter,
  diffSorter,
  editFormatter,
  meanSemFormatter,
  metadataFormatter,
  metricsBadgeFormatter,
  modelFormatter,
  numericSorter,
  parameterFormatter,
  rankBadge,
  rankFormatter,
  rankOrder,
  rankUsageFormatter,
  rankValue,
  roleBadgeFormatter,
  scoreFormatter,
  sortSuites,
  statusFormatter,
  suiteBadgesFormatter,
  taskLinkAttributes,
  taskLinkFormatter,
  taskMetricFormatter,
  taskNameFormatter,
};
