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

const STATUS_OPTIONS = STATUSES.map(status => ({ value: status, label: status }));


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
 * @param showModel   add Model and Team columns. For a list spanning models.
 * @returns the Tabulator instance.
 */
function renderSubmissionsTable({ container, submissions, showModel = false }) {
  return createFilterableTable({
    container,
    rows: toSubmissionRows(submissions),
    columns: getSubmissionColumns({ showModel }),
    controls: getSubmissionControls(),
    noun: "submissions",
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
 * @returns every row it built, not just the slice it rendered, so a caller can report
 *          a total alongside the preview.
 */
function renderStaticSubmissionsTable({ container, submissions, showModel = false, limit }) {
  const rows = toSubmissionRows(submissions);

  resolveContainer(container, "renderStaticSubmissionsTable").innerHTML = renderStaticTable({
    columns: getSubmissionColumns({ showModel }),
    rows: previewRows(rows, (a, b) => dateSorter(b.updated_at, a.updated_at), limit),
  });

  return rows;
}


export {
  renderSubmissionsTable,
  renderStaticSubmissionsTable,
  STATUSES,
};
