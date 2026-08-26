// Filterable submissions table
//
// The table allows you to search by submission name and filter by suite or submission status
//
// This code just defines the columns, rows and controls. Table infrastructure lives in utils/tables.js

import { suitesFromSubmission } from "../core/suites.js";
import {
  SUITE_OPTIONS,
  createFilterableTable,
  previewRows,
  renderStaticTable,
  resolveContainer,
  matchEquals,
  matchInArray,
  matchIncludes,
} from "./table.js";
import {
  dateFormatter,
  dateSorter,
  linkFormatter,
  metadataFormatter,
  statusFormatter,
  suiteBadgesFormatter,
} from "./formatters.js";

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

const STATUSES = ["pending", "scoring", "done", "failed"];

const STATUS_OPTIONS = STATUSES.map((status) => ({
  value: status,
  label: status,
}));

// ─── ROWS ───────────────────────────────────────────────────────────────────

function toSubmissionRow(submission) {
  return {
    id: submission.id,
    label: submission.label,
    // Always mapped, even though only the `showModel` columns render them: it costs
    // nothing, and it keeps one row shape whichever caller built the table.
    model_name: submission.model_name ?? null,
    team_name: submission.team_name ?? null,
    updated_at: submission.updated_at,
    status: submission.status,
    suites: suitesFromSubmission(submission),
  };
}

function toSubmissionRows(submissions) {
  return submissions.map(toSubmissionRow);
}

// ─── COLUMNS ────────────────────────────────────────────────────────────────

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

// ─── CONTROLS ───────────────────────────────────────────────────────────────

function getSubmissionControls() {
  return [
    {
      type: "search",
      name: "label",
      placeholder: "Search by label...",
      match: matchIncludes("label"),
    },
    {
      type: "select",
      name: "suite",
      placeholder: "All suites",
      options: SUITE_OPTIONS,
      match: matchInArray("suites"),
    },
    {
      type: "select",
      name: "status",
      placeholder: "All statuses",
      options: STATUS_OPTIONS,
      match: matchEquals("status"),
    },
  ];
}

// ─── TABLE ──────────────────────────────────────────────────────────────────

/**
 * @param container   element, or the id of one. Its contents are replaced.
 * @param submissions list of submissions with taskSubmissions attached, mapped to rows by toSubmissionRows().
 * @param rows        already-mapped rows, for a caller that mapped them itself — see
 *                    renderModelsTable. Pass one or the other, not both.
 * @param showModel   add Model and Team columns. For a list spanning models.
 * @param showFilters keep the filter bar above the grid. False for a caller with a bar of
 *                    its own over both its views — see templates/list-page.js.
 * @returns the Tabulator instance.
 */
function renderSubmissionsTable({
  container,
  submissions,
  rows = toSubmissionRows(submissions),
  showModel = false,
  showFilters = true,
}) {
  return createFilterableTable({
    container,
    rows,
    columns: getSubmissionColumns({ showModel }),
    controls: showFilters ? getSubmissionControls() : [],
    noun: "submission",
    initialSort: [{ column: "updated_at", dir: "desc" }],
    caller: "renderSubmissionsTable",
  });
}

// ─── STATIC TABLE ───────────────────────────────────────────────────────────

/**
 * Plain-markup counterpart to renderSubmissionsTable, for a fixed preview — no filters,
 * no paging, and no Tabulator needed on the page.
 *
 * @param container   element, or the id of one. Its contents are replaced.
 * @param submissions as renderSubmissionsTable.
 * @param showModel   as renderSubmissionsTable.
 * @param limit       how many rows to show. Omit for all of them.
 * @param viewAll     as renderStaticTable — where the footer's "View all" link goes.
 * @returns every row it built, not just the slice it rendered. The total is already in
 *          the footer; this is for a caller that needs the rows themselves.
 */
function renderStaticSubmissionsTable({
  container,
  submissions,
  showModel = false,
  limit,
  viewAll,
}) {
  const rows = toSubmissionRows(submissions);

  const shown = previewRows(
    rows,
    (a, b) => dateSorter(b.updated_at, a.updated_at),
    limit,
  );

  resolveContainer(container, "renderStaticSubmissionsTable").innerHTML =
    renderStaticTable({
      columns: getSubmissionColumns({ showModel }),
      rows: shown,
      noun: "submission",
      total: rows.length,
      viewAll,
    });

  return rows;
}

export {
  getSubmissionControls,
  renderSubmissionsTable,
  renderStaticSubmissionsTable,
  toSubmissionRows,
  STATUSES,
};
