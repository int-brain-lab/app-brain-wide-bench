// Filterable table of one submission's task submissions and their methodology
// parameters. All the table plumbing lives in tables/utils.js — this module is just
// the rows, the columns and the two controls.
//
// Distinct from tables/tasks.js, which is about *scores* across submissions. This one
// is about the parameters a submission declared for each task, and each row links to
// the page that edits them.

import { escapeHtml } from "../utils.js";
import { suiteOf } from "../scores.js";
import { TASK_FIELDS, trainingFieldKeys } from "../tasks/schema.js";
import {
  SUITE_OPTIONS,
  createFilterableTable,
  matchEquals,
  matchIncludes,
  suiteBadgeFormatter,
} from "./utils.js";


// ─── ROWS ───────────────────────────────────────────────────────────────────

// The methodology fields, taken from TASK_FIELDS' panel 1 rather than listed here, so
// this table and the task editor can't disagree about what "the parameters" are —
// adding a `panel: 1` field to the schema adds a column here automatically.
function parameterKeys() {
  return trainingFieldKeys();
}

// The parameters are spread onto the row rather than nested, because a Tabulator
// column addresses its value by a flat `field` name.
//
// `submission_id` rides along unused by any column: the Task link needs both ids, and
// a formatter can only reach what's on the row.
function toRow(submission, taskSubmission) {
  const parameters = Object.fromEntries(
    parameterKeys().map(key => [key, taskSubmission[key]])
  );

  return {
    id: taskSubmission.id,
    submission_id: submission.id,
    task_id: taskSubmission.task_id,
    suite: suiteOf(taskSubmission.task_id),
    ...parameters,
  };
}


// ─── COLUMNS ────────────────────────────────────────────────────────────────

// Not linkFormatter: that builds `page?id=<one id>`, and editing a task submission
// needs the submission it belongs to as well as the task itself.
function taskEditHref(row) {
  return `/html/tasks/task_details.html`
    + `?submission=${encodeURIComponent(row.submission_id)}`
    + `&task=${encodeURIComponent(row.id)}`;
}

function taskLinkFormatter(cell) {
  const row = cell.getData();

  return `<a href="${taskEditHref(row)}">${escapeHtml(row.task_id)}</a>`;
}

// The icon is a Lucide placeholder, which only becomes an <svg> once createIcons()
// runs — createFilterableTable's renderComplete does that after every render, since
// Tabulator rebuilds its rows on filter, sort and page changes.
function editFormatter(cell) {
  return `
    <a class="btn with-icon" href="${taskEditHref(cell.getData())}">
      <i class="btn-icon" data-lucide="pencil"></i>
      Edit
    </a>
  `;
}

// Parameter values are enums, or arrays of them for the multi-select fields. Escaped
// even though they're server-side enums rather than user prose, for the same
// uniformity as the rest of the app's builders.
function parameterFormatter(cell) {
  const value = cell.getValue();

  if (Array.isArray(value)) {
    return value.length
      ? `<span class="metadata">${escapeHtml(value.join(", "))}</span>`
      : `<span class="metadata">—</span>`;
  }

  return value == null || value === ""
    ? `<span class="metadata">—</span>`
    : `<span class="metadata">${escapeHtml(value)}</span>`;
}

// `showEdit` appends a per-row Edit button. Off by default so the submission
// dashboard's static preview stays a summary — there the Task cell's own link is the
// way through, and a column of buttons would compete with the page's own actions.
function getColumns(showEdit = false, selectable = false) {
  // Tabulator's built-in selection column. `cellClick` toggling is what makes the
  // header's select-all and the per-row checkbox behave; without it the checkbox
  // renders but does nothing.
  const selectColumn = selectable
    ? [{
        formatter: "rowSelection",
        titleFormatter: "rowSelection",
        headerSort: false,
        width: 44,
        hozAlign: "center",
        cellClick: (event, cell) => cell.getRow().toggleSelect(),
      }]
    : [];

  const editColumn = showEdit
    ? [{
        title: "",
        field: "id",
        formatter: editFormatter,
        headerSort: false,
        width: 110,
        hozAlign: "right",
      }]
    : [];

  return [
    ...selectColumn,
    {
      title: "Task",
      field: "task_id",
      formatter: taskLinkFormatter,
      widthGrow: 2,
    },
    {
      title: "Suite",
      field: "suite",
      formatter: suiteBadgeFormatter,
      width: 100,
    },
    ...parameterKeys().map(key => ({
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


// ─── CONTROLS ───────────────────────────────────────────────────────────────

// Two only. A submission covers at most the benchmark's handful of tasks, so anything
// more would be more filter than table — and suite is the one cut that's actually
// useful when a submission spans several.
function getControls() {
  return [
    {
      type: "search",
      name: "task_id",
      placeholder: "Search tasks...",
      match: matchIncludes("task_id"),
    },
    {
      type: "select",
      name: "suite",
      placeholder: "All suites",
      options: SUITE_OPTIONS,
      match: matchEquals("suite"),
    },
  ];
}


/**
 * @param container  element, or the id of one. Its contents are replaced.
 * @param submission a submission detail record — its `task_submissions` are the rows,
 *                   and its id is half of each row's edit link.
 * @returns the Tabulator instance.
 */
function renderTaskSubmissionsTable({
  container,
  submission,
  showEdit = true,
  selectable = false,
  onSelectionChange,
}) {
  const taskSubmissions = submission.task_submissions ?? [];

  return createFilterableTable({
    container,
    rows: taskSubmissions.map(taskSubmission => toRow(submission, taskSubmission)),
    columns: getColumns(showEdit, selectable),
    controls: getControls(),
    noun: "tasks",
    initialSort: [{ column: "task_id", dir: "asc" }],
    selectable,
    onSelectionChange,
    caller: "renderTaskSubmissionsTable",
  });
}


export {
  renderTaskSubmissionsTable,
  toRow,
  // Exported so the submission dashboard can render these same columns as plain
  // markup via renderStaticTable — one definition of what a task submission row is,
  // whether it appears as a preview or as the full filterable table.
  getColumns as taskSubmissionColumns,
};
