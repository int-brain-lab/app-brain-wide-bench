// Filterable submissions table
//
// The table allows you to search by submission name and filter by suite or submission status
//
// This code just defines the columns, rows and controls. Table infrastructure lives in utils/tables.js

import {
  createFilterableTable,
  previewRows,
  buildStaticTable,
} from "./table.js";
import { getSubmissionFilters } from "../utils/submissionUtils.js";
import {
  dateFormatter,
  dateSorter,
  linkFormatter,
  metadataFormatter,
  statusFormatter,
  suiteBadgesFormatter,
} from "./formatters.js";



// ─── COLUMNS ─────────────────────────────────────────────────────────────────

// showModel adds the model and team columns, for a list of submissions spanning models.
// Otherwise the table is for a single model and those columns are redundant.
function getSubmissionColumns({ showModel = false } = {}) {
  const modelColumns = showModel
    ? [
        {
          title: "Model",
          field: "model_name",
          formatter: metadataFormatter,
        },
        {
          title: "Team",
          field: "team_name",
          formatter: metadataFormatter,
        },
      ]
    : [];

  return [
    {
      title: "Label",
      field: "label",
      formatter: linkFormatter("/html/submissions/submissions.html", "label"),
      widthGrow: 2,
    },
    ...modelColumns,
    {
      title: "Last updated",
      field: "updated_at",
      formatter: dateFormatter,
      sorter: dateSorter,
    },
    {
      title: "Status",
      field: "status",
      formatter: statusFormatter,
    },
    {
      title: "Suites",
      field: "suites",
      formatter: suiteBadgesFormatter,
      headerSort: false,
    },
  ];
}

// ─── TABLE ───────────────────────────────────────────────────────────────────

/**
 * @param rows        rows from toSubmissionRows.
 * @param showModel   add Model and Team columns. For a list spanning models.
 * @param showFilters keep the filter bar above the grid. False for a caller with a bar of
 *                    its own over both its views — see templates/listPage.js.
 * @returns { element, table } — as createModelsTable; the caller mounts the element.
 */
function createSubmissionsTable({
  rows,
  showModel = false,
  showFilters = true,
}) {
  return createFilterableTable({
    rows,
    columns: getSubmissionColumns({ showModel }),
    controls: showFilters ? getSubmissionFilters() : [],
    noun: "submission",
    initialSort: [{ column: "updated_at", dir: "desc" }],
    caller: "createSubmissionsTable",
  });
}

// ─── STATIC TABLE ────────────────────────────────────────────────────────────

/**
 * Plain-markup counterpart to createSubmissionsTable, for a fixed preview — no filters,
 * no paging, and no Tabulator needed on the page.
 *
 * @param rows        as createSubmissionsTable.
 * @param showModel   as createSubmissionsTable.
 * @param limit       how many rows to show. Omit for all of them.
 * @param viewAll     as buildStaticTable — where the footer's "View all" link goes.
 * @returns the markup. The caller writes it where it wants it.
 */
function buildStaticSubmissionsTable({
  rows,
  showModel = false,
  limit,
  viewAll,
}) {
  const shown = previewRows(
    rows,
    (a, b) => dateSorter(b.updated_at, a.updated_at),
    limit,
  );

  return buildStaticTable({
    columns: getSubmissionColumns({ showModel }),
    rows: shown,
    noun: "submission",
    total: rows.length,
    viewAll,
  });
}

export {
  createSubmissionsTable,
  buildStaticSubmissionsTable,
};
