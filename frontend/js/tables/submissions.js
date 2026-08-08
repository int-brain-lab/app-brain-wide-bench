// Filterable submissions table: a label search plus suite and status selects above
// a Tabulator grid. All the table plumbing lives in tables/utils.js — this module
// is just the rows, the columns and the three controls.
//
// The columns mirror the "Recent submissions" table on model_dashboard
// (buildSubmissionRow in js/models/details/details-view.js) and reuse the same
// badge builders, so a row reads identically in both places.

import { buildStatusBadge, suitesOf } from "../utils/score-cards.js";
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
} from "./utils.js";


// ─── CONSTANTS ──────────────────────────────────────────────────────────────

// Mirrors SubmissionStatus in app/models.py. Hardcoded rather than derived from
// the rows so the select offers every status the server can return — otherwise
// "failed" would vanish from the dropdown exactly when a user has no failed
// submissions to go looking for.
const STATUSES = ["pending", "scoring", "done", "failed"];

const STATUS_OPTIONS = STATUSES.map(status => ({ value: status, label: status }));


// ─── ROWS ───────────────────────────────────────────────────────────────────

// `suites` is resolved once here rather than in the formatter: the filter tests it on
// every keystroke, and suitesOf may have to walk task_submissions and build a Set. It
// also keeps the column and the filter reading the same value.
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
    suites: suitesOf(submission),
  };
}


// ─── COLUMNS ────────────────────────────────────────────────────────────────

function statusFormatter(cell) {
  return buildStatusBadge(cell.getValue());
}

// `showModel` adds the Model and Team columns. Off by default because the callers
// that sit inside one model's context — model_submissions.html, and the dashboard's
// recent-submissions preview — would just repeat the page's own heading down every
// row. The submissions list spans models, so there it earns its width.
//
// Exported (as submissionColumns) so the dashboard preview can render these same
// columns as plain markup via renderStaticTable, rather than restating the link
// target, date format and badges in its own <td>s.
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
      formatter: linkFormatter("/html/submissions/submission_dashboard.html", "label"),
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


/**
 * @param container   element, or the id of one. Its contents are replaced.
 * @param submissions records from GET /api/models/{id} (`model.submissions`) or
 *                    GET /api/submissions. Suite badges and the suite filter need
 *                    `task_submissions` on each record, which only the former has —
 *                    SubmissionResponse omits it, so those rows show no suites.
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
