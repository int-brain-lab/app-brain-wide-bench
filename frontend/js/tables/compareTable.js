// The comparison page's two grids: models down the side, tasks across the top.
//
// Both are the same table with different cells — scores in one, differences against the
// baseline in the other — so they share a builder and differ only in the formatter their
// cells take and whether the baseline gets a row at all.
//
// Models are the rows because a model is the thing being compared: picking another is another
// row rather than another column squeezing the rest, and a row can carry what identifies it —
// the name, the team, and the colour the same model is drawn in everywhere else.

import { taskLabel } from "../core/suites.js";
import { escapeHtml } from "../core/html.js";
import { buildMetricBadgeList } from "../components/badges.js";
import { createTable } from "./table.js";
import {
  compareScoreSorter,
  diffFormatter,
  diffSorter,
  meanSemFormatter,
} from "./formatters.js";

// Colour reaches markup as a custom property, and escapeHtml does not sanitise CSS, so what
// goes in is checked rather than trusted.
const HEX = /^#[0-9a-f]{3,8}$/i;

// ─── CELLS ───────────────────────────────────────────────────────────────────

// The model name over its team, marked in the colour it is plotted in and with the page's own
// model badged so it can be picked out of six rows. "This model" rather than "Reference": the
// difference grid has a baseline the reader chooses, and a badge reading "Reference" beside a
// grid measuring against something else would name the wrong thing.
//
// No link to the model page: a click selects and sorts, and a link competing with that is a
// coin toss for the reader. The picker above already names every model.
//
// Model and team names are user-supplied, so both are escaped.
function modelFormatter(cell) {
  const { modelName, teamName, isSelected, colour } = cell.getData();

  const badge = isSelected
    ? `<span class="badge sm neutral">This model</span>`
    : "";

  const ink = HEX.test(colour ?? "") ? ` style="--row-ink:${colour}"` : "";

  return `
    <span class="column gap-xs compare-model"${ink}>
      <span class="row left gap-sm">
        <span class="label">${escapeHtml(modelName)}</span>
        ${badge}
      </span>
      <span class="metadata">${escapeHtml(teamName ?? "")}</span>
    </span>
  `;
}

// ─── COLUMNS ─────────────────────────────────────────────────────────────────

// The task without its suite — every column carries the same one — over the metric it is
// measured in. The metric belongs to the task, so it is named once here rather than on every
// cell beneath it.
function taskHeader({ taskId, metric }) {
  return `
    <span class="column gap-xs right">
      <span>${escapeHtml(taskLabel(taskId))}</span>
      ${metric ? buildMetricBadgeList([metric], "sm") : ""}
    </span>
  `;
}

function getCompareColumns(tasks, { formatter, sorter }) {
  return [
    {
      title: "Model",
      field: "modelName",
      formatter: modelFormatter,
      // Fixed rather than growing: a model name has a natural size, and the space a
      // comparison of two models leaves over belongs to the tasks being compared.
      width: 220,
      // Held while the tasks scroll: which model a row belongs to is what makes a number
      // readable, and a suite of a dozen tasks is wider than the page.
      frozen: true,
    },
    ...tasks.map((task) => ({
      title: taskHeader(task),
      // The header is markup, so Tabulator has to be told not to escape it.
      titleFormatter: "html",
      field: task.taskId,
      formatter,
      sorter,
      // An equal share of whatever the model column leaves, so the grid always spans the full
      // width and the columns re-divide it as the suite changes. minWidth is the floor at
      // which they stop shrinking and the grid scrolls instead.
      widthGrow: 1,
      minWidth: 120,
      hozAlign: "right",
      headerHozAlign: "right",
      // Matches the room the header reserves for its sort arrow, so the numbers sit directly
      // under the task they belong to — see .num-cell in style.css.
      cssClass: "num-cell",
    })),
  ];
}

// ─── TABLE ───────────────────────────────────────────────────────────────────

/**
 * @param rows  from compareData's toCompareRows — one per model.
 * @param tasks from compareData's compareTasks — the columns, in the order the plots put
 *              them on their axis.
 * @param mode  "score" for mean ± sem cells, "diff" for signed differences.
 * @returns { element, table } — `element` is detached until the caller places it, and
 *          `table` has to be destroyed before it is replaced.
 */
function createCompareTable({ rows, tasks, mode = "score" }) {
  const cells =
    mode === "diff"
      ? { formatter: diffFormatter, sorter: diffSorter }
      : { formatter: meanSemFormatter, sorter: compareScoreSorter };

  return createTable({
    rows,
    columns: getCompareColumns(tasks, cells),
    noun: "model",

    // fitColumns, as every other grid in the app uses: the number of columns here changes
    // with the suite, and a fixed width would leave the table stopping short of its own
    // container with two tasks and overflowing with twelve. The widthGrow/minWidth pair
    // above is what makes it divide the width instead — and still scroll, rather than
    // squeeze past readability, once the minimums no longer fit.
    layout: "fitColumns",

    // A comparison holds at most five models, so a pager would only ever show "1".
    paginationSize: rows.length + 1,

    // The rows arrive in the picker's order. Sorting by a task — which is how you ask "who is
    // strongest here?" — is the reader's to request.
    caller: "createCompareTable",
  });
}

export { createCompareTable };
