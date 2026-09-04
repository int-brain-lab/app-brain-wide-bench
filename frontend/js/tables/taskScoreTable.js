// Filterable task-score table: one row per scored task, across however many submissions
// the caller passes in.
//
// The columns only. Rows and filters are in utils/taskScoreUtils.js, and the table
// infrastructure in table.js.

import { getTaskScoreFilters } from "../utils/taskScoreUtils.js";
import {
  buildStaticTable,
  createFilterableTable,
  previewRows,
} from "./table.js";
import {
  buildLinkFormatter,
  taskNameFormatter,
  numericSorter,
  rankUsageFormatter,
  buildScoreSemFormatter,
  buildTaskSuiteFormatter, parameterFormatter,
} from "./formatters.js";
import {TASK_FIELDS, trainingFieldKeys} from "../schemas/taskSubmissionSchema.js";

// ─── COLUMNS ─────────────────────────────────────────────────────────────────

// `showSubmission` off drops the Submission column, for a caller already scoped to one
// submission — there it would repeat the page's own heading down every row.
//
// `showRanking` adds the column saying which rankings each score is carrying. Off by
// default: it needs rows stamped by markRankedRows, which only a page that has fetched the
// model's ranking can do.
function getScoreColumns({
  showSubmission = true,
  showModel = false,
  showRanking = false,
} = {}) {
  const modelColumn = showModel
    ? [
        {
          title: "Model",
          field: "model_name",
          formatter: buildLinkFormatter(
            "/html/models/models.html",
            "model_name",
            "model_id",
          ),
          // widthGrow: 2,
        },
      ]
    : [];

  const submissionColumn = showSubmission
    ? [
        {
          title: "Submission",
          field: "submission_label",
          formatter: buildLinkFormatter(
            "/html/submissions/submissions.html",
            "submission_label",
            "submission_id",
          ),
          // widthGrow: 2,
        },
      ]
    : [];

  // Last: it is provenance for the score to its left rather than a fact about the task.
  // Unsorted, because the order it would impose — carrying both, one, neither — is the one
  // the reader is already scanning for.
  const rankingColumn = showRanking
    ? [
        {
          title: "Used in ranking",
          field: "ranked",
          formatter: rankUsageFormatter,
          headerSort: false,
          // width: 170,
        },
      ]
    : [];

  return [
    {
      // The suite rides under the name rather than in a column of its own: it is a fact
      // about the task, derived from its id (see toScoreRow), so a column would have
      // repeated a prefix already on screen down a hundred-pixel band of its own. `suite`
      // stays a field on the row either way, which is what the select above filters on.
      title: "Task",
      field: "task_name",
      formatter: taskNameFormatter,
      // widthGrow: 2,
    },
    ...modelColumn,
    ...submissionColumn,
    {
      // Mean, sem and the metric all three in one cell — see buildScoreSemFormatter. The field
      // stays `mean_score` so the sort is on the number, not on the spread or the badge
      // printed beside it.
      //
      // The metric belongs here rather than in a column because a score without it is not
      // a figure a reader can use: 0.61 is good bacc and poor r2, and the two used to sit
      // at opposite ends of the row.
      title: "Score",
      field: "mean_score",
      formatter: buildScoreSemFormatter("sem", { metricField: "metric" }),
      sorter: numericSorter,
      // minWidth: 220,
    },
    ...trainingFieldKeys().map((key) => ({
      title: TASK_FIELDS[key].label,
      field: key,
      formatter: parameterFormatter,
      // The multi-value fields hold arrays, which don't sort meaningfully, and the
      // rest are unordered enums — so no column here earns a sort.
      headerSort: false,
      // minWidth: 150,
    })),
    ...rankingColumn,
  ];
}

// ─── TABLE ───────────────────────────────────────────────────────────────────

/**
 * The live task-scores table, filterable above the grid.
 *
 * @param rows           rows from toScoreRows (records nesting their tasks) or
 *                       toScoreResultRows (already-flat task submissions).
 * @param showSubmission keep the Submission column and its filter. Pass false when every
 *                       row belongs to the same submission.
 * @param showModel      add the Model column and its filter. For rows spanning models.
 * @param showRanking    add the "Used in ranking" column. Rows must be stamped by
 *                       markRankedRows first — see getScoreColumns.
 * @param showFilters    keep the filter bar above the grid. False for a caller with a bar
 *                       of its own — see templates/listView.js.
 * @param selection      as createFilterableTable. What is picked is shown by highlighting
 *                       the row, one or several, rather than by a column of checkboxes.
 *
 * @returns { element, table } — the caller mounts the element.
 */
function createTaskScoresTable({
  rows,
  showSubmission = true,
  showModel = false,
  showRanking = false,
  showFilters = true,
  selection,
}) {
  const shown = { showSubmission, showModel, showRanking };

  return createFilterableTable({
    rows,
    columns: getScoreColumns(shown),
    controls: showFilters ? getTaskScoreFilters(rows, shown) : [],
    noun: "task",
    initialSort: [{ column: "mean_score", dir: "desc" }],
    index: "id",
    layout: "fitData",
    selection,
    paginationSize: 8,
  });
}

// ─── STATIC TABLE ────────────────────────────────────────────────────────────

/**
 * Plain-markup counterpart to createTaskScoresTable, for a fixed preview — no filters,
 * no paging, and no Tabulator needed on the page.
 *
 * @param rows           as createTaskScoresTable.
 * @param showSubmission as createTaskScoresTable.
 * @param showModel      as createTaskScoresTable.
 * @param showRanking    as createTaskScoresTable.
 * @param limit          how many rows to show. Omit for all of them.
 * @param viewAll        as buildStaticTable — where the footer's "View all" link goes.
 *
 * @returns the markup. The caller writes it where it wants it.
 */
function buildStaticTaskScoresTable({
  rows,
  showSubmission = true,
  showModel = false,
  showRanking = false,
  limit,
  viewAll,
}) {
  const shown = previewRows(
    rows,
    (a, b) => numericSorter(b.mean_score, a.mean_score),
    limit,
  );

  return buildStaticTable({
    columns: getScoreColumns({ showSubmission, showModel, showRanking }),
    rows: shown,
    noun: "task",
    total: rows.length,
    viewAll,
  });
}

export { createTaskScoresTable, buildStaticTaskScoresTable };
