// Filterable submissions table
//
// The table allows you to search by submission name and filter by suite or submission status
//
// This code just defines the columns, rows and controls. Table infrastructure lives in utils/tables.js

import { suitesFromSubmission } from "../core/suites.js";
import { buildStatusBadge} from "../components/badges.js";
import {
  SUITE_OPTIONS,
  createFilterableTable,
  dateFormatter,
  dateSorter,
  linkFormatter,
  matchEquals,
  matchInArray,
  matchIncludes,
  metadataFormatter,
  suiteBadgesFormatter,
} from "./table.js";


// ─── CONSTANTS ──────────────────────────────────────────────────────────────

const STATUSES = ["pending", "scoring", "done", "failed"];

const STATUS_OPTIONS = STATUSES.map(status => ({ value: status, label: status }));


// ─── ROWS ───────────────────────────────────────────────────────────────────

function toRow(submission) {
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


// ─── COLUMNS ────────────────────────────────────────────────────────────────

function statusFormatter(cell) {
  return buildStatusBadge(cell.getValue());
}

// showModel adds the model and team columns, for a list of submissions spanning models.
// Otherwise the table is for a single model and those columns are redundant.
function getColumns(showModel) {
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

function getControls() {
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

// ─── TABLE ───────────────────────────────────────────────────────────────
/**
 * @param container   element, or the id of one. Its contents are replaced.
 * @param submissions list of submissions with taskSubmissions attached. Each submission is mapped to a row with toRow().
 * @param showModel   add Model and Team columns. For a list spanning models.
 * @returns the Tabulator instance.
 */
function renderSubmissionsTable({ container, submissions, showModel = false }) {
  return createFilterableTable({
    container,
    rows: submissions.map(toRow),
    columns: getColumns(showModel),
    controls: getControls(),
    noun: "submissions",
    initialSort: [{ column: "updated_at", dir: "desc" }],
    caller: "renderSubmissionsTable",
  });
}


export {
  renderSubmissionsTable,
  toRow,
  getColumns as submissionColumns,
  STATUSES,
};
