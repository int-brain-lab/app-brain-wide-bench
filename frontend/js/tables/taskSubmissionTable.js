// Filterable table of one submission's task submissions and their methodology parameters.
//
// The table allows you to search by task and filter by suite.
//
// The columns only. Rows and filters are in utils/taskSubmissionUtils.js, and the table
// infrastructure in table.js.

import { TASK_FIELDS, trainingFieldKeys } from "../schemas/taskSubmissionSchema.js";
import { getTaskSubmissionFilters } from "../utils/taskSubmissionUtils.js";
import { buildStaticTable, createFilterableTable, previewRows } from "./table.js";
import {
  buildFlagFormatter,
  buildScoreSemFormatter,
  editFormatter,
  metricBadgeFormatter,
  numericSorter,
  parameterFormatter,
  scoreBarFormatter,
  taskNameFormatter,
} from "./formatters.js";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

// The narrowest each kind of column may be drawn. The table fills the width it is given and
// shares out what is spare, so these are floors rather than sizes.
const TASK_WIDTH = 120;
const SCORE_WIDTH = 130;
const FIELD_WIDTH = 120;
const FLAG_WIDTH = 130;

// A bar is the one column with nothing to read in it, so it gives way first — but below
// this it is too short to compare one row against another.
const BAR_WIDTH = 120;

// ─── COLUMNS ─────────────────────────────────────────────────────────────────

// `showEdit` appends a per-row Edit button. `showScore` drops the Score column, for a
// caller reporting the scores elsewhere. Both off by default.
//
// The methodology columns come from TASK_FIELDS' `methodology` panel rather than a list
// here, so adding a field to that panel adds a column automatically.
function getTaskSubmissionColumns({ showEdit = false, showScore = true } = {}) {
  const editColumn = showEdit
    ? [
        {
          title: "",
          field: "id",
          formatter: editFormatter,
          headerSort: false,
          width: 110,
          hozAlign: "right",
        },
      ]
    : [];

  const scoreColumn = showScore
    ? [
        {
          title: "Score",
          field: "mean_score",
          formatter: buildScoreSemFormatter("sem", { metricField: "metric" }),
          sorter: numericSorter,
          width: 220,
        },
      ]
    : [];

  return [
    {
      title: "Task",
      field: "task_id",
      formatter: taskNameFormatter,
      widthGrow: 2,
    },
    ...scoreColumn,
    ...trainingFieldKeys().map((key) => ({
      title: TASK_FIELDS[key].label,
      field: key,
      formatter: parameterFormatter,
      // The multi-value fields hold arrays, which don't sort meaningfully, and the
      // rest are unordered enums — so no column here earns a sort.
      headerSort: false,
    })),
    ...editColumn,
  ];
}

// ─── TABLE ───────────────────────────────────────────────────────────────────

/**
 * The live task-submissions table, filterable above the grid.
 *
 * @param rows        rows from toTaskSubmissionRows.
 * @param showEdit    append the per-row Edit button.
 * @param showScore   keep the Score column. False for a caller reporting scores elsewhere.
 * @param showFilters keep the filter bar above the grid. False for a caller with a bar of
 *                    its own — see templates/listView.js.
 * @param selection   as createFilterableTable. Keyed on the task submission id.
 *
 * @returns { element, table } — the caller mounts the element.
 */
function createTaskSubmissionsTable({
  rows,
  showEdit = true,
  showScore = true,
  showFilters = true,
  selection,
}) {
  return createFilterableTable({
    rows,
    columns: getTaskSubmissionColumns({ showEdit, showScore }),
    controls: showFilters ? getTaskSubmissionFilters(rows) : [],
    noun: "task",
    initialSort: [{ column: "task_id", dir: "asc" }],
    index: "id",
    selection,
  });
}

// ─── SCORES ──────────────────────────────────────────────────────────────────

// What one submission scored, task by task: the number, the same number as a mark, what it
// is measured in, and whether the model still stands on it.
//
// Its own column set rather than more flags on getTaskSubmissionColumns above: that one
// describes how a task was produced, and this one describes what it produced.
function getScoreColumns() {
  return [
    {
      title: "Task",
      field: "task_id",
      formatter: taskNameFormatter,
      widthGrow: 1,
      minWidth: TASK_WIDTH,
    },
    {
      // The mean over its spread. The metric has a column of its own here, so it is not
      // badged beside the number as it is on the methodology table.
      title: "Score",
      field: "mean_score",
      formatter: buildScoreSemFormatter("sem"),
      sorter: numericSorter,
      widthGrow: 1,
      minWidth: SCORE_WIDTH,
    },
    {
      // Read on 0 to 1 like every primary metric, so one row's bar is comparable with the
      // next even where the metrics are not.
      title: "",
      field: "mean_score",
      formatter: scoreBarFormatter,
      headerSort: false,
      widthGrow: 2,
      minWidth: BAR_WIDTH,
    },
    {
      title: "Metric",
      field: "metric",
      formatter: metricBadgeFormatter,
      headerSort: false,
      widthGrow: 1,
      minWidth: FIELD_WIDTH,
    },
    {
      // Not "used in ranking", which is the model page's question: this page is about one
      // run, and what it wants to know is whether that run is still the one that counts.
      title: "Latest entry",
      field: "latest",
      formatter: buildFlagFormatter((row) => row.latest, "The model's current entry for this task"),
      headerSort: false,
      hozAlign: "center",
      headerHozAlign: "center",
      widthGrow: 1,
      minWidth: FLAG_WIDTH,
    },
  ];
}

/**
 * What one submission scored, as plain markup.
 *
 * @param rows    task rows stamped by markStandingRows.
 *
 * @returns the markup.
 */
function buildSubmissionScoresTable({ rows }) {
  return buildStaticTable({
    columns: getScoreColumns(),
    rows: [...rows].sort((a, b) => numericSorter(b.mean_score, a.mean_score)),
    noun: "task",
    total: rows.length,
  });
}

// ─── STATIC TABLE ────────────────────────────────────────────────────────────

/**
 * Plain-markup counterpart to createTaskSubmissionsTable, for a fixed preview — no
 * filters, no paging, and no Tabulator needed on the page.
 *
 * @param rows      as createTaskSubmissionsTable.
 * @param showEdit  as getTaskSubmissionColumns. The button routes with `data-view="task"`,
 *                  which only a page owning that view can answer — see core/router.js.
 * @param showScore as getTaskSubmissionColumns.
 * @param limit     how many rows to show. Omit for all of them.
 *
 * @returns the markup.
 */
function buildStaticTaskSubmissionsTable({ rows, showEdit = false, showScore = true, limit }) {
  const shown = previewRows(rows, (a, b) => String(a.task_id).localeCompare(b.task_id), limit);

  return buildStaticTable({
    columns: getTaskSubmissionColumns({ showEdit, showScore }),
    rows: shown,
    noun: "task",
    total: rows.length,
  });
}

export { buildStaticTaskSubmissionsTable, buildSubmissionScoresTable, createTaskSubmissionsTable };
