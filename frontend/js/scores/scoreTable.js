// Filterable task-score table: one row per scored task, across however many
// submissions the caller passes in. All the table plumbing lives in
// utils/tables.js — this module is just the rows, the columns and the controls.
//
// Rows are the *flattening* of submissions → task_submissions, so one submission
// covering four tasks becomes four rows. That's what makes "which submission scored
// best on ts1-reward" answerable, which the per-submission tables can't show.

import { escapeHtml } from "../utils.js";
import { suiteFromTask } from "../utils/suites.js";
import {
  SUITE_OPTIONS,
  createFilterableTable,
  linkFormatter,
  matchEquals,
  matchIncludes,
  numericSorter,
  metricPillsFormatter,
  optionsFromRows,
  suiteBadgeFormatter,
  score
} from "../utils/tables.js";


// ─── ROWS ───────────────────────────────────────────────────────────────────

// The metric *name* lives on the task catalogue (GET /api/tasks/), not on the
// score — TaskScoreOut carries only the value. Without the catalogue the column
// falls back to "—" rather than the table refusing to render.
function metricsByTaskId(tasks) {
  return new Map(tasks.map(task => [task.id, task.primary_metric]));
}

// One row per task submission. `task_name` is the subtask half of the flat id
// ("reward" from "ts1-reward"), since the suite is already its own column — the
// full id would read as "ts1" twice.
function toRows(submissions, tasks = []) {
  const metrics = metricsByTaskId(tasks);

  return submissions.flatMap(submission =>
    (submission.task_submissions ?? []).map(taskSubmission => ({
      id: taskSubmission.id,
      task_id: taskSubmission.task_id,
      task_name: taskSubmission.task_id,
      suite: suiteFromTask(taskSubmission.task_id),
      submission_id: submission.id,
      submission_label: submission.label,
      // Only a model *detail* response's submissions lack these, so a caller flattening
      // several models attaches them itself before calling in — see js/dashboard.
      model_id: submission.model_id ?? null,
      model_name: submission.model_name ?? null,
      // Both null for a task that hasn't been scored yet — the formatter shows "—"
      // and the sorter pushes it to the bottom. `sem` is separately nullable even
      // on a scored task: TaskScoreOut declares primary_metric_sem optional, so a
      // single-seed run has a mean but no spread.
      mean_score: taskSubmission.score?.primary_metric_mean ?? null,
      sem: taskSubmission.score?.primary_metric_sem ?? null,
      metric: metrics.get(taskSubmission.task_id) ?? null,
    }))
  );
}


// ─── COLUMNS ────────────────────────────────────────────────────────────────

function taskNameFormatter(cell) {
  return `<span class="label">${escapeHtml(cell.getValue())}</span>`;
}

function scoreFormatter(cell) {
  return score(cell.getValue());
}

// Prefixed so the column reads as a spread rather than as a second score, and
// muted so it doesn't compete with the mean beside it. score() already renders a
// missing value as "—", which shouldn't carry a ±.
function semFormatter(cell) {
  const value = cell.getValue();

  return value == null
    ? `<span class="metadata">—</span>`
    : `<span class="metadata">± ${score(value)}</span>`;
}


// `showSubmission` off drops the Submission column, for a caller already scoped to one
// — the submission dashboard's preview, where it would repeat the page's own heading
// down every row. On by default: the model-wide table spans submissions, so there it
// is the column doing the most work.
// Options object rather than positional flags: with two independent toggles,
// `getColumns(false, true)` at a call site says nothing about which is which.
function getColumns({ showSubmission = true, showModel = false } = {}) {
  const modelColumn = showModel
    ? [{
        title: "Model",
        field: "model_name",
        formatter: linkFormatter("/html/models/model_dashboard.html", "model_name", "model_id"),
        widthGrow: 2,
      }]
    : [];

  const submissionColumn = showSubmission
    ? [{
        title: "Submission",
        field: "submission_label",
        formatter: linkFormatter("/html/submissions/submission_dashboard.html", "submission_label", "submission_id"),
        widthGrow: 2,
      }]
    : [];

  return [
    {
      title: "Task",
      field: "task_name",
      formatter: taskNameFormatter,
      widthGrow: 2,
    },
    ...modelColumn,
    {
      title: "Suite",
      field: "suite",
      formatter: suiteBadgeFormatter,
      width: 100,
    },
    ...submissionColumn,
    {
      title: "Mean score",
      field: "mean_score",
      formatter: scoreFormatter,
      sorter: numericSorter,
      width: 120,
    },
    {
      title: "SEM",
      field: "sem",
      formatter: semFormatter,
      sorter: numericSorter,
      width: 100,
    },
    {
      title: "Metric",
      field: "metric",
      formatter: metricPillsFormatter,
      headerSort: false,
    },
  ];
}


// ─── CONTROLS ───────────────────────────────────────────────────────────────

// Suite options are hardcoded from SUITES (a fixed server enum), submission labels
// come from the rows — there's no enum of those, and the ones present are exactly
// the ones worth offering.
//
// `suite` is a single value per row here, not the array the submissions and models
// tables carry, so this matches with matchEquals rather than matchInArray.
// `showSubmission` drops the submission select alongside its column, for a caller
// already scoped to one submission — a select whose every option is the same value
// filters nothing.
function getControls(rows, { showSubmission = true, showModel = false } = {}) {
  const modelControl = showModel
    ? [{
        type: "select",
        name: "model_name",
        placeholder: "All models",
        options: optionsFromRows(rows, "model_name"),
        match: matchEquals("model_name"),
      }]
    : [];

  const submissionControl = showSubmission
    ? [{
        type: "select",
        name: "submission_label",
        placeholder: "All submissions",
        options: optionsFromRows(rows, "submission_label"),
        match: matchEquals("submission_label"),
      }]
    : [];

  return [
    {
      type: "search",
      name: "task_name",
      placeholder: "Search tasks...",
      match: matchIncludes("task_name"),
    },
    {
      type: "select",
      name: "suite",
      placeholder: "All suites",
      options: SUITE_OPTIONS,
      match: matchEquals("suite"),
    },
    ...modelControl,
    ...submissionControl,
  ];
}


/**
 * @param container   element, or the id of one. Its contents are replaced.
 * @param submissions records carrying `task_submissions` — a model detail's
 *                    `submissions`, or `[submission]` for a single submission's
 *                    tasks. GET /api/submissions rows have no task_submissions and
 *                    so contribute no rows at all.
 * @param tasks       the catalogue from GET /api/tasks/, for the Metric column.
 *                    Optional; without it Metric reads "—".
 * @param showSubmission  keep the Submission column and its filter. Pass false when
 *                    every row belongs to the same submission.
 * @returns the Tabulator instance.
 */
function renderTaskScoresTable({
  container,
  submissions,
  tasks = [],
  showSubmission = true,
  showModel = false,
}) {
  const rows = toRows(submissions, tasks);
  const shown = { showSubmission, showModel };

  return createFilterableTable({
    container,
    rows,
    columns: getColumns(shown),
    controls: getControls(rows, shown),
    noun: "tasks",
    initialSort: [{ column: "mean_score", dir: "desc" }],
    caller: "renderTaskScoresTable",
  });
}


export {
  renderTaskScoresTable,
  toRows,
  // Exported so the submission dashboard can render these same columns as plain markup
  // via renderStaticTable — one definition of what a task-score row looks like,
  // whether it appears as a preview or as the full filterable table.
  getColumns as taskScoreColumns,
  numericSorter as scoreSorter,
};
