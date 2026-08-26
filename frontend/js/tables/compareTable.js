// The comparison page's two grids: tasks down the side, models across the top.
//
// Both are the same table with different cells — scores in one, differences against the
// selected model in the other — so they share a builder and differ only in their rows,
// their cell formatter and whether the reference model gets a column at all.
//
// Tasks are the rows because a suite has many more tasks than a comparison has models, and
// because it puts the metric on the row: filtering by it is then an ordinary row filter,
// not the column-hiding special case the other arrangement would need.
//
// Neither grid carries the metric select itself. One control drives both — it is the same
// question asked of the same tasks — so the page owns it and reaches in through
// applyMetricFilter.

import { createFilterableTable } from "./table.js";
import { resolveContainer } from "../core/dom.js";
import { escapeHtml, showEmpty } from "../core/utils.js";
import {
  compareScoreSorter,
  diffFormatter,
  diffSorter,
  meanSemFormatter,
  taskMetricFormatter,
} from "./formatters.js";

// ─── COLUMNS ────────────────────────────────────────────────────────────────

// The model name over its team, with the page's own model badged so it can be picked out of
// six columns. "This model" rather than "Reference": the difference grid now has a baseline
// the reader chooses, and a badge reading "Reference" beside a grid measuring against
// something else would name the wrong thing.
//
// No link to the model page: a click on a header sorts the column, and a link competing
// with that is a coin toss for the reader. The picker below already names every model.
//
// Tabulator inserts this as HTML, and model and team names are user-supplied, so both are
// escaped.
function modelHeader({ modelName, teamName, isSelected }) {
  const badge = isSelected
    ? `<span class="badge sm neutral">This model</span>`
    : "";

  return `
    <span class="column gap-xs right">
      <span class="row left gap-sm">
        <span>${escapeHtml(modelName)}</span>
        ${badge}
      </span>
      <span class="metadata">${escapeHtml(teamName ?? "")}</span>
    </span>
  `;
}

function getCompareColumns(models, { formatter, sorter }) {
  return [
    {
      title: "Task",
      field: "taskId",
      // Carries the metric badge as well — see taskMetricFormatter. `metric` stays a field
      // on the row without a column of its own, which is all the filter below needs.
      formatter: taskMetricFormatter,
      // Fixed rather than growing: the task name has a natural size, and the space a
      // comparison of two models leaves over belongs to the two columns being compared,
      // not to a label that is the same length either way.
      width: 240,
      minWidth: 240,
      // A score is meaningless without the task it belongs to, and six models on a narrow
      // window still overflow the minWidths below and scroll.
      frozen: true,
    },
    ...models.map((model) => ({
      title: modelHeader(model),
      // The header is markup, so Tabulator has to be told not to escape it.
      titleFormatter: "html",
      field: model.modelId,
      formatter,
      sorter,
      // An equal share of whatever the task column leaves, so the grid always spans the
      // full width and the columns re-divide it as models are added and removed. minWidth
      // is the floor at which they stop shrinking and the grid scrolls instead.
      widthGrow: 1,
      minWidth: 140,
      hozAlign: "right",
      headerHozAlign: "right",
      // Matches the room the header reserves for its sort arrow, so the numbers sit
      // directly under the model they belong to — see .num-cell in style.css.
      cssClass: "num-cell",
    })),
  ];
}

// ─── TABLE ──────────────────────────────────────────────────────────────────

/**
 * @param container element, or the id of one. Its contents are replaced.
 * @param rows      from compareData's toScoreRows or toDiffRows — one per task.
 * @param models    from compareData's compareModels — the columns, in order.
 * @param metric    the metric to show, or "" for all of them. Applied as the grid's
 *                  initial filter so it is in place before the first render.
 * @param mode      "score" for mean ± sem cells, "diff" for signed differences.
 * @returns the Tabulator instance, so the page can destroy it on the next render.
 */
function renderCompareTable({
  container,
  rows,
  models,
  metric = "",
  mode = "score",
}) {
  const cells =
    mode === "diff"
      ? { formatter: diffFormatter, sorter: diffSorter }
      : { formatter: meanSemFormatter, sorter: compareScoreSorter };

  return createFilterableTable({
    container,
    rows,
    columns: getCompareColumns(models, cells),
    noun: "task",

    // fitColumns, as every other grid in the app uses: the number of columns here changes
    // as the reader picks models, and a fixed width would leave the table stopping short of
    // its own container with two of them and overflowing with six. The widthGrow/minWidth
    // pair above is what makes it divide the width instead — and still scroll, rather than
    // squeeze past readability, once the minimums no longer fit.
    layout: "fitColumns",

    ...(metric
      ? { initialFilter: [{ field: "metric", type: "=", value: metric }] }
      : {}),

    // A suite is a dozen tasks at most, so a pager would only ever show "1".
    paginationSize: rows.length + 1,

    // The rows arrive ordered by task id. Sorting by a model's column — which is how you
    // ask "where is this model strongest?" — is the reader's to request.
    caller: "renderCompareTable",
  });
}

/**
 * Narrow a grid to one metric, or to all of them with "". Both grids are driven from the
 * single select on the page, so this is called once per grid on every change.
 *
 * A no-op on a null handle: a grid that had nothing to show was never mounted, and the
 * page holds the same variable for both cases.
 */
function applyMetricFilter(table, metric) {
  if (!table) return;

  if (metric) table.setFilter("metric", "=", metric);
  else table.clearFilter();
}

/**
 * The empty state both grids share — a comparison with nothing scored on the chosen suite,
 * or a difference grid with no comparators yet. Returns null so a caller can assign it to
 * the same handle a table would have gone in and destroy it unconditionally.
 */
function showNoComparison(container, message) {
  showEmpty(resolveContainer(container), message);

  return null;
}

export { renderCompareTable, applyMetricFilter, showNoComparison };
