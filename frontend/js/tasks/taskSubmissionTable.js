// Filterable table of one submission's task submissions and their methodology
// parameters. All the table plumbing lives in utils/tables.js — this module is just
// the rows, the columns and the two controls.


import { escapeHtml } from "../utils.js";
import { suiteFromTask } from "../utils/suites.js";
import { TASK_FIELDS, trainingFieldKeys } from "./taskSubmissionSchema.js";
import {
  SUITE_OPTIONS,
  createFilterableTable,
  matchEquals,
  matchIncludes,
  suiteBadgeFormatter,
} from "../utils/tables.js";


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
    suite: suiteFromTask(taskSubmission.task_id),
    ...parameters,
  };
}


// ─── COLUMNS ────────────────────────────────────────────────────────────────

// Not linkFormatter: that builds an href, and these rows only ever render inside the
// submission record page — so they route through it. `data-task` is the declared view param
// the router copies from the link's dataset into the URL.
function taskLinkAttributes(row) {
  return `href="#" data-view="task" data-task="${escapeHtml(row.id)}"`;
}

function taskLinkFormatter(cell) {
  const row = cell.getData();

  return `<a ${taskLinkAttributes(row)}>${escapeHtml(row.task_id)}</a>`;
}


function editFormatter(cell) {
  return `
    <a class="btn with-icon" ${taskLinkAttributes(cell.getData())}>
      <i class="btn-icon" data-lucide="pencil"></i>
      Edit
    </a>
  `;
}


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

// `showEdit` appends a per-row Edit button. Off by default
function getColumns(showEdit = false) {


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
}) {
  const taskSubmissions = submission.task_submissions ?? [];

  return createFilterableTable({
    container,
    rows: taskSubmissions.map(taskSubmission => toRow(submission, taskSubmission)),
    columns: getColumns(showEdit),
    controls: getControls(),
    noun: "tasks",
    initialSort: [{ column: "task_id", dir: "asc" }],
    caller: "renderTaskSubmissionsTable",
  });
}


export {
  renderTaskSubmissionsTable,
  toRow,
  getColumns as taskSubmissionColumns,
};
