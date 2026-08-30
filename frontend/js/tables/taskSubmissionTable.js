// Filterable table of one submission's task submissions and their methodology parameters.
//
// The table allows you to search by task and filter by suite.
//
// The columns only. Rows and filters are in utils/taskSubmissionUtils.js, and the table
// infrastructure in table.js.

import {
  TASK_FIELDS,
  trainingFieldKeys,
} from "../schemas/taskSubmissionSchema.js";
import { getTaskSubmissionFilters } from "../utils/taskSubmissionUtils.js";
import {
  buildStaticTable,
  createFilterableTable,
  previewRows,
} from "./table.js";
import {
  editFormatter,
  numericSorter,
  parameterFormatter,
  buildScoreSemFormatter,
  suiteBadgesFormatter,
  taskLinkFormatter,
} from "./formatters.js";

// ─── COLUMNS ─────────────────────────────────────────────────────────────────

// `showEdit` appends a per-row Edit button. Off by default.
//
// The methodology columns come from TASK_FIELDS' `methodology` panel rather than a list
// here, so adding a field to that panel adds a column automatically.
function getTaskSubmissionColumns({ showEdit = false } = {}) {
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

  return [
    {
      title: "Task",
      field: "task_id",
      formatter: taskLinkFormatter,
      widthGrow: 2,
    },
    {
      title: "Suite",
      field: "suite",
      formatter: suiteBadgesFormatter,
      width: 100,
    },
    {
      title: "Score",
      field: "mean_score",
      formatter: buildScoreSemFormatter("sem", { metricField: "metric" }),
      sorter: numericSorter,
      width: 220,
    },
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
 * @param showFilters keep the filter bar above the grid. False for a caller with a bar of
 *                    its own — see templates/listView.js.
 * @param selection   as createFilterableTable. Keyed on the task submission id.
 *
 * @returns { element, table } — the caller mounts the element.
 */
function createTaskSubmissionsTable({
  rows,
  showEdit = true,
  showFilters = true,
  selection,
}) {
  return createFilterableTable({
    rows,
    columns: getTaskSubmissionColumns({ showEdit }),
    controls: showFilters ? getTaskSubmissionFilters(rows) : [],
    noun: "task",
    initialSort: [{ column: "task_id", dir: "asc" }],
    index: "id",
    selection,
  });
}

// ─── STATIC TABLE ────────────────────────────────────────────────────────────

/**
 * Plain-markup counterpart to createTaskSubmissionsTable, for a fixed preview — no
 * filters, no paging, and no Tabulator needed on the page.
 *
 * @param rows    as createTaskSubmissionsTable.
 * @param limit   how many rows to show. Omit for all of them.
 * @param viewAll as buildStaticTable — where the footer's "View all" link goes.
 *
 * @returns the markup.
 */
function buildStaticTaskSubmissionsTable({ rows, limit, viewAll }) {
  const shown = previewRows(
    rows,
    (a, b) => String(a.task_id).localeCompare(b.task_id),
    limit,
  );

  return buildStaticTable({
    // No Edit column: the button routes through the record page's task view, which a
    // preview isn't.
    columns: getTaskSubmissionColumns(),
    rows: shown,
    noun: "task",
    total: rows.length,
    viewAll,
  });
}

export { createTaskSubmissionsTable, buildStaticTaskSubmissionsTable };
