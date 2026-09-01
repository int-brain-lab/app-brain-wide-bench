// The leaderboard: a rank, a model, and one column per task the reader has chosen.
//
// A column per task rather than per suite, and this is the whole reason the board is shaped
// this way: a suite carries several metrics — TS1 alone has `bacc`, `poisson_d2` and `r2`,
// which share neither a scale nor a chance level — so a suite-level mean ± sem would be
// arithmetic over incommensurable numbers. One task is one metric, so its mean and its
// spread are a quantity a reader can read.
//
// Columns and the mount only. The rows and the ranking over them are
// utils/leaderboardUtils.js, as every other table's are.

import { suiteFromTask, taskLabel } from "../core/suites.js";
import { escapeHtml } from "../core/html.js";
import { buildMetricBadge, buildSuiteBadge } from "../components/badges.js";
import { createTable } from "./table.js";
import {
  buildMeanSem,
  meanSorter,
  modelFormatter,
  rankFormatter,
  rankSorter,
} from "./formatters.js";

// ─── COLUMNS ─────────────────────────────────────────────────────────────────

// The task without its suite, over the suite and the metric it is measured in — the suite
// because two suites can carry one metric, the metric because it is the unit of every number
// in the column.
function taskHeader(taskId, metric) {
  const suite = suiteFromTask(taskId);

  return `
    <span class="column gap-xs right">
      <span>${escapeHtml(taskLabel(taskId))}</span>
      <span class="row left gap-sm">
        ${suite ? buildSuiteBadge(suite, "sm") : ""}
        ${metric ? buildMetricBadge(metric, "sm") : ""}
      </span>
    </span>`;
}

// The cell is the whole score object, so both halves print from one field and a sorter can
// read `.mean` without a parallel set of fields — see buildMeanSem.
function scoreFormatter(cell) {
  const entry = cell.getValue();

  return buildMeanSem(entry?.mean ?? null, entry?.sem ?? null, {
    stacked: true,
  });
}

function getColumns(taskIds, metrics) {
  return [
    {
      title: "Rank",
      field: "rank",
      formatter: rankFormatter,
      // Not numericSorter: it sorts a null first ascending, which puts every unranked model
      // above the board.
      sorter: rankSorter,
      width: 90,
      frozen: true,
    },
    {
      title: "Model",
      field: "model_name",
      formatter: modelFormatter,
      // Held while the tasks scroll: which model a row belongs to is what makes a number
      // readable, and eight tasks are wider than the page.
      frozen: true,
      width: 240,
    },
    ...taskIds.map((taskId) => ({
      title: taskHeader(taskId, metrics[taskId]),
      // The header is markup, so Tabulator has to be told not to escape it.
      titleFormatter: "html",
      field: taskId,
      formatter: scoreFormatter,
      sorter: meanSorter,
      widthGrow: 1,
      minWidth: 110,
      hozAlign: "right",
      headerHozAlign: "right",
      // Matches the room the header reserves for its sort arrow — see .num-cell.
      cssClass: "num-cell",
    })),
  ];
}

// ─── TABLE ───────────────────────────────────────────────────────────────────

/**
 * @param rows      from toLeaderboardRows.
 * @param taskIds   the chosen tasks, in column order.
 * @param metrics   `{ taskId: metric }` — from toTaskMetrics, so a header can name its unit
 *                  whether or not anyone has been scored on it yet.
 * @param selection from bindTableSelection, to make the rows pickable for a comparison. Omit
 *                  for a board that is only read.
 * @returns { element, table } — `element` is detached until the caller places it, and
 *          `table` has to be destroyed before it is replaced.
 */
function createLeaderboardTable({ rows, taskIds, metrics = {}, selection }) {
  return createTable({
    rows,
    columns: getColumns(taskIds, metrics),
    noun: "model",
    selection,
    // A row is one model, so the model is what identifies it — and what a comparison knows the
    // pick by. See toModelEntry in pages/leaderboard.js.
    index: "modelId",
    // The rows arrive in position order — see byPosition. Stated so the header shows which
    // column the board is sorted by.
    initialSort: [{ column: "rank", dir: "asc" }],
    layout: "fitColumns",
    paginationSize: 10,
    caller: "createLeaderboardTable",
  });
}

export { createLeaderboardTable };
