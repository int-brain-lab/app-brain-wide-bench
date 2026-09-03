// The leaderboard: a rank, a model, and one column per task the reader has chosen.
//
// A column per task rather than per suite, and this is the whole reason the board is shaped
// this way: a suite carries several metrics — TS1 alone has `bacc`, `poisson_d2` and `r2`,
// which share neither a scale nor a chance level — so a suite-level mean ± sem would be
// arithmetic over incommensurable numbers. One task is one metric, so its mean and its
// spread are a quantity a reader can read.
//
// How many of those there are decides how it is laid out. A few, and the columns are stretched
// to fill the page; more than fills it, and each is sized to what it holds and the board
// scrolls sideways under two frozen columns. The headings follow the same count, since a wide
// column has room for a task's metric beside its name where a narrow one does not.
//
// Columns and the mount only. The rows and the ranking over them are
// utils/leaderboardUtils.js, as every other table's are.

import { suiteFromTask, taskLabel } from "../core/suites.js";
import { escapeHtml } from "../core/html.js";
import { buildMetricBadge, buildTaskBadge } from "../components/badges.js";
import { createTable } from "./table.js";
import {
  buildMeanSem,
  meanSorter,
  modelFormatter,
  rankFormatter,
  rankSorter,
  taskHeader
} from "./formatters.js";

// ─── COLUMNS ─────────────────────────────────────────────────────────────────

// How many task columns the page can stretch to and still leave each of them readable. At or
// below this the board fills the width; above it the columns are sized to what they hold and
// the board scrolls sideways instead.
//
// The two layouts are each bad at the case the other is for. Stretched, a board of eleven
// tasks squeezes every column below the width of the number in it — hiding what the board
// exists to show; sized to fit, a board of three is a huddle of columns against a page of
// whitespace. So the count decides, and it is a count rather than a measurement deliberately:
// a layout that changed as the window moved would re-flow the header under the reader's hand.
const COLUMNS_THAT_FIT = 8;

// And how few it takes for a stretched column to be wide enough to head with two badges on one
// line. A lower number than the one above, because "fits" and "has room to spare" are
// different questions: eight columns fit, at about the width of "0.641 ± 0.025" each, which is
// no room for a task name and a metric side by side.
const COLUMNS_WITH_ROOM = 4;

// The narrowest a task column may be drawn, stretched or sized to fit: a mean over its spread,
// plus the room the header reserves for its sort arrow.
const TASK_WIDTH = 96;

// Whether the board can be stretched to fill the page, and whether its columns are then wide
// enough to head across rather than down. Both off the one count, so the layout and the
// headings cannot disagree about how much room there is.
function fits(taskIds) {
  return taskIds.length <= COLUMNS_THAT_FIT;
}

function roomy(taskIds) {
  return taskIds.length <= COLUMNS_WITH_ROOM;
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
  // The metric under the task rather than beside it, wherever a column is too narrow to carry
  // both on one line — see taskHeader.
  const stacked = !roomy(taskIds);

  return [
    {
      title: "Rank",
      field: "rank",
      formatter: rankFormatter,
      // Not numericSorter: it sorts a null first ascending, which puts every unranked model
      // above the board.
      sorter: rankSorter,
      // A number, not a layout name: a column's `width` is a width, and Tabulator reads
      // anything else as none at all.
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
      minWidth: 200,
      // What is left over on a stretched board comes here rather than to the numbers: a name
      // is as long as it is, where a score has a width of its own and reads no better for
      // having more. Inert under fitData, where the name sizes its own column.
      widthGrow: 3,
    },
    ...taskIds.map((taskId) => ({
      title: taskHeader(taskId, metrics[taskId], { stacked }),
      // The header is markup, so Tabulator has to be told not to escape it.
      titleFormatter: "html",
      field: taskId,
      formatter: scoreFormatter,
      sorter: meanSorter,
      // Both, because only one applies at a time: `widthGrow` shares out a stretched board,
      // and `minWidth` floors a column Tabulator is sizing to its contents — and floors a
      // stretched one too, which is what makes a board of eleven scroll rather than squeeze.
      widthGrow: 1,
      minWidth: TASK_WIDTH,
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
    // Fill the page while the columns still have room to be read in, and size them to their
    // contents once they don't. Settled once per board rather than watched: the board is
    // rebuilt whenever the choice of tasks changes — see renderBoard in pages/leaderboard.js.
    layout: fits(taskIds) ? "fitColumns" : "fitData",
    paginationSize: 8,
    caller: "createLeaderboardTable",
  });
}

export { createLeaderboardTable };
