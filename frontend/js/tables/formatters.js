// Shared Tabulator formatters, sorters and the builders that make them.
//
// Table scaffolding lives in table.js; domain tables provide their own columns and rows.
// Formatters return HTML, so every dynamic value must be escaped.
//
// A `*Formatter` is passed to a column by reference. A `build*Formatter` is called first,
// with what that column needs, and returns one.

import { escapeHtml } from "../core/html.js";
import { buildScoreBar } from "../components/bars.js";
import { suiteFromTask, taskFullLabel, taskLabel } from "../core/suites.js";
import { formatDate, score } from "../core/utils.js";
import {
  buildMetricBadge,
  buildMetricBadgeList,
  buildMineBadge,
  buildPretrainedBadge,
  buildRoleBadge,
  buildStatusBadge,
  buildSuiteBadgeList, buildTaskBadge,
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

  // No alignment of its own: the two lines stretch, so the column they are in decides where
  // they sit — a mean with no spread is a bare value and follows it either way.
  return stacked
    ? `<span class="column gap-xs">${value}${spread}</span>`
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

// ─── BUILDERS ────────────────────────────────────────────────────────────────

/**
 * A formatter linking each row to its own page.
 *
 * @param page       the page the link goes to; the row id becomes its `?id=`.
 * @param labelField the row field the link text comes from.
 * @param idField    the row field holding the id. Defaults to "id".
 * @param className  classes on the link — "metadata" for a column that says where a row came
 *                   from rather than what it is. Omit for the text colour and size.
 *
 * @returns a Tabulator formatter.
 */
function buildLinkFormatter(page, labelField, idField = "id", className = "") {
  return (cell) => {
    const row = cell.getData();

    return `
      <a
        href="${page}?id=${encodeURIComponent(row[idField])}"
        class="${escapeHtml(className)}"
      >
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
      <span class="row left gap-lg">
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
      <span class="label">${escapeHtml(row.model_name)}</span>
      <span>${badges}</span>
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

// The score again, as a mark. Read on 0 to 1 like every primary metric, and in the colour
// of the suite the task belongs to.
function scoreBarFormatter(cell) {
  const row = cell.getData();

  return buildScoreBar(cell.getValue(), row.suite ?? "");
}

// One metric on its own, for a table that badges it in a column rather than beside the
// number — see metricsBadgeFormatter for the list.
function metricBadgeFormatter(cell) {
  const value = cell.getValue();

  return value ? buildMetricBadge(value, "sm") : EMPTY_VALUE;
}

// Whether the public ranking is standing on this score, and where it isn't, whether that is
// because the run behind it has not been published. The two are one column: a reader
// scanning it wants to know what counts, and an eye is the answer to why something doesn't.
function rankingFlagFormatter(cell) {
  const row = cell.getData();

  if (row.ranked?.public) {
    return buildIcon("tick", {
      className: "tick-icon",
      title: "Counted in the public ranking",
    });
  }

  if (row.is_public === false) {
    return buildIcon("private", {
      title: "Not published, so not counted in the public ranking",
    });
  }

  return emptyMetadata();
}

// Where the score places on its own task, against the models scored on that task — a
// narrower field than the suite around it. Empty for an entry the ranking did not place.
function taskRankFormatter(cell) {
  const row = cell.getData();

  if (row.rank == null) return emptyMetadata();

  return `
    <span class="row left gap-sm">
      <span class="bold">#${escapeHtml(String(row.rank))}</span>
      <span class="metadata">of ${escapeHtml(String(row.nRanked))}</span>
    </span>
  `;
}

function metricsBadgeFormatter(cell) {
  const value = cell.getValue();
  const metrics = Array.isArray(value) ? value : value == null ? [] : [value];

  return metrics.length ? buildMetricBadgeList(metrics) : EMPTY_VALUE;
}

// The suite in front of the short name — "TS1 Choice". On a list spanning every suite the
// short names alone are ambiguous, and the badge's colour says the suite to a reader who
// already knows the palette rather than to one meeting it.
function taskNameFormatter(cell) {
  const value = cell.getValue();

  if (!value) return EMPTY_VALUE;

  return `<span>${buildTaskBadge(
    taskFullLabel(value),
    suiteFromTask(value),
    "sm",
  )}</span>`;
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

/**
 * A formatter for a column that answers yes or no: a tick where it holds, a dash where it
 * does not.
 *
 * @param read  (row) => whether this row is one of them.
 * @param title hover text on the tick, for a column whose heading is read once and then
 *              scrolled away from.
 *
 * @returns a Tabulator formatter.
 */
function buildFlagFormatter(read, title) {
  return (cell) =>
    read(cell.getData())
      ? buildIcon("tick", { className: "tick-icon", title })
      : emptyMetadata();
}

// Signed and coloured by which way it went — see .diff-up in style.css.
function buildDiff(diff) {
  if (diff == null) return emptyMetadata();

  const direction = diff > 0 ? "diff-up" : diff < 0 ? "diff-down" : "diff-flat";

  const sign = diff > 0 ? "+" : "";

  return `<span class="${direction}">${sign}${escapeHtml(score(diff))}</span>`;
}

/**
 * One task's column heading: what it is, in its suite's colour, and what it is measured in.
 *
 * @param stacked the metric under the task rather than beside it, for a column sized to what
 *                it holds, where a heading laid out across would set the width instead — a
 *                task name and a metric side by side are wider than "0.641 ± 0.025". Side by
 *                side where the layout stretches the columns anyway, since two badges on one
 *                line keep the header row shallow. See getColumns in leaderboardTable.js.
 * @param align   how the badges sit in it — `left`, `centre` or `right`. Badges are boxes, so
 *                this is theirs to set: text alignment does not place them.
 */
function taskHeader(taskId, metric, { stacked = true, align = "left" } = {}) {
  const suite = suiteFromTask(taskId);

  const badges = [
    suite ? buildTaskBadge(taskLabel(taskId), suite, "sm") : "",
    metric ? buildMetricBadge(metric, "sm") : "",
  ].join("");

  return `
    <span class="${stacked ? "column" : "row"} ${escapeHtml(align)} gap-xs">
      ${badges}
    </span>`;
}




export {
  buildDiff,
  buildLinkFormatter,
  buildMeanSem,
  buildModelNameFormatter,
  buildFlagFormatter,
  buildScoreSemFormatter,
  buildTaskSuiteFormatter,
  dateFormatter,
  dateSorter,
  editFormatter,
  meanSorter,
  metadataFormatter,
  metricBadgeFormatter,
  metricsBadgeFormatter,
  modelFormatter,
  numericSorter,
  parameterFormatter,
  rankBadge,
  rankFormatter,
  rankingFlagFormatter,
  scoreBarFormatter,
  taskRankFormatter,
  rankSorter,
  roleBadgeFormatter,
  statusFormatter,
  valueSorter,
  suiteBadgesFormatter,
  taskLinkAttributes,
  taskLinkFormatter,
  taskNameFormatter,
  taskHeader,
};
