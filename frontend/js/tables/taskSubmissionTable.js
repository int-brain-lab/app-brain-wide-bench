// Filterable table of one submission's task submissions and their methodology
// parameters. All the table plumbing lives in utils/tables.js — this module is just
// the rows, the columns and the two controls.

import { suiteFromTask } from "../core/suites.js";
import { resolveContainer } from "../core/dom.js";
import {
  TASK_FIELDS,
  trainingFieldKeys,
} from "../schemas/taskSubmissionSchema.js";
import {
  SUITE_OPTIONS,
  createFilterableTable,
  previewRows,
  renderStaticTable,
  matchEquals,
  matchIncludes,
} from "./table.js";
import {
  editFormatter,
  parameterFormatter,
  suiteBadgeFormatter,
  taskLinkFormatter,
} from "./formatters.js";

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
function toTaskSubmissionRow(submission, taskSubmission) {
  const parameters = Object.fromEntries(
    parameterKeys().map((key) => [key, taskSubmission[key]]),
  );

  return {
    id: taskSubmission.id,
    submission_id: submission.id,
    task_id: taskSubmission.task_id,
    suite: suiteFromTask(taskSubmission.task_id),
    ...parameters,
  };
}

// Plural counterpart. The submission is the same for every row — it carries the id the
// edit link needs — so it stays outside the map rather than being repeated per task.
function toTaskSubmissionRows(
  submission,
  taskSubmissions = submission.task_submissions ?? [],
) {
  return taskSubmissions.map((taskSubmission) =>
    toTaskSubmissionRow(submission, taskSubmission),
  );
}

// ─── COLUMNS ────────────────────────────────────────────────────────────────

// `showEdit` appends a per-row Edit button. Off by default
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
      formatter: suiteBadgeFormatter,
      width: 100,
    },
    ...parameterKeys().map((key) => ({
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

function getTaskSubmissionControls() {
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

// ─── TABLE ──────────────────────────────────────────────────────────────────

/**
 * @param container  element, or the id of one. Its contents are replaced.
 * @param submission a submission detail record — its `task_submissions` are the rows,
 *                   and its id is half of each row's edit link.
 * @param showEdit   append the per-row Edit button.
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
    rows: toTaskSubmissionRows(submission, taskSubmissions),
    columns: getTaskSubmissionColumns({ showEdit }),
    controls: getTaskSubmissionControls(),
    noun: "task",
    initialSort: [{ column: "task_id", dir: "asc" }],
    caller: "renderTaskSubmissionsTable",
  });
}

// ─── STATIC TABLE ───────────────────────────────────────────────────────────

/**
 * Plain-markup counterpart to renderTaskSubmissionsTable, for a fixed preview — no
 * filters, no paging, and no Tabulator needed on the page.
 *
 * @param container  element, or the id of one. Its contents are replaced.
 * @param submission as renderTaskSubmissionsTable.
 * @param limit      how many rows to show. Omit for all of them.
 * @param viewAll     as renderStaticTable — where the footer's "View all" link goes.
 * @returns every row it built, not just the slice it rendered. The total is already in
 *          the footer; this is for a caller that needs the rows themselves.
 */
function renderStaticTaskSubmissionsTable({
  container,
  submission,
  limit,
  viewAll,
}) {
  const rows = toTaskSubmissionRows(submission);

  const shown = previewRows(
    rows,
    (a, b) => String(a.task_id).localeCompare(b.task_id),
    limit,
  );

  resolveContainer(container, "renderStaticTaskSubmissionsTable").innerHTML =
    renderStaticTable({
      // No Edit column: the button routes through the record page's task view, which a
      // preview isn't.
      columns: getTaskSubmissionColumns(),
      rows: shown,
      noun: "task",
      total: rows.length,
      viewAll,
    });

  return rows;
}

export { renderTaskSubmissionsTable, renderStaticTaskSubmissionsTable };
