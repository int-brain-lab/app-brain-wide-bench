// Filterable task-score table: one row per scored task, across however many
// submissions the caller passes in. All the table plumbing lives in
// utils/tables.js — this module is just the rows, the columns and the controls.
//
// Rows are the *flattening* of submissions → task_submissions, so one submission
// covering four tasks becomes four rows. That's what makes "which submission scored
// best on ts1-reward" answerable, which the per-submission tables can't show.

import { escapeHtml } from "../core/utils.js";
import { suiteFromTask } from "../core/suites.js";
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
} from "./table.js";


// ─── ROWS ───────────────────────────────────────────────────────────────────

// TaskScoreOut now carries `primary_metric`, the name of the metric its mean and sem
// are measured in, so a scored row is self-describing.
//
// The task catalogue (GET /api/tasks/) is still accepted, and still consulted for rows
// that have no score: an unscored task has no TaskScoreOut to carry the name, and the
// column read "—" rather than naming the metric the task will be scored on. Passing it
// is optional — without it those rows fall back to "—".
function metricsByTaskId(tasks) {
  return new Map((tasks ?? []).map(task => [task.id, task.primary_metric]));
}

// The one definition of a task-score row, shared by both adapters below so the table's
// columns don't have to care whether the rows were nested inside submissions or came
// back flat from GET /api/users/me/task-submissions.
function toRow({ taskSubmission, score, submission, model, metrics }) {
  return {
    id: taskSubmission.id,
    task_id: taskSubmission.task_id,
    task_name: taskSubmission.task_id,
    suite: suiteFromTask(taskSubmission.task_id),
    submission_id: submission.id ?? null,
    submission_label: submission.label ?? null,
    model_id: model.id ?? null,
    model_name: model.name ?? null,
    // Both null for a task that hasn't been scored yet — the formatter shows "—"
    // and the sorter pushes it to the bottom. `sem` is separately nullable even
    // on a scored task: TaskScoreOut declares primary_metric_sem optional, so a
    // single-seed run has a mean but no spread.
    mean_score: score?.primary_metric_mean ?? null,
    sem: score?.primary_metric_sem ?? null,
    metric: score?.primary_metric ?? metrics.get(taskSubmission.task_id) ?? null,
  };
}

// One row per task submission, from records that *nest* their tasks — a submission
// detail, or a model detail's embedded submissions. `task_name` is the subtask half of
// the flat id ("reward" from "ts1-reward"), since the suite is already its own column —
// the full id would read as "ts1" twice.
function toRows(submissions, tasks = []) {
  const metrics = metricsByTaskId(tasks);

  return submissions.flatMap(submission =>
    (submission.task_submissions ?? []).map(taskSubmission =>
      toRow({
        taskSubmission,
        score: taskSubmission.score,
        submission,
        // Only a model *detail* response's submissions lack these, so a caller flattening
        // several models attaches them itself before calling in.
        model: { id: submission.model_id, name: submission.model_name },
        metrics,
      })
    )
  );
}

// One row per entry of GET /api/users/me/task-submissions, which is already flat — one
// task per row, each naming its own submission, model and team. No flattening to do, so
// this is a rename of the server's field names onto the table's.
function toResultRows(results, tasks = []) {
  const metrics = metricsByTaskId(tasks);
  console.log(metrics)
  console.log(results[10])
  return (results ?? []).map(result =>
    toRow({
      taskSubmission: result,
      score: result.score,
      submission: { id: result.submission_id, label: result.submission_name },
      model: { id: result.model_id, name: result.model_name },
      metrics,
    })
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
        formatter: linkFormatter("/html/models/models.html", "model_name", "model_id"),
        widthGrow: 2,
      }]
    : [];

  const submissionColumn = showSubmission
    ? [{
        title: "Submission",
        field: "submission_label",
        formatter: linkFormatter("/html/submissions/submissions.html", "submission_label", "submission_id"),
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
 * @param rows        already-built rows, from toResultRows. Takes precedence over
 *                    `submissions`, for a caller whose source is already flat — the
 *                    dashboard, off GET /api/users/me/task-submissions.
 * @param tasks       the catalogue from GET /api/tasks/, naming the metric on rows
 *                    that have no score to name it themselves. Optional.
 * @param showSubmission  keep the Submission column and its filter. Pass false when
 *                    every row belongs to the same submission.
 * @returns the Tabulator instance.
 */
function renderTaskScoresTable({
  container,
  submissions,
  rows: prebuiltRows,
  tasks = [],
  showSubmission = true,
  showModel = false,
}) {
  const rows = prebuiltRows ?? toRows(submissions, tasks);
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
  toResultRows,
  // Exported so the submission dashboard can render these same columns as plain markup
  // via renderStaticTable — one definition of what a task-score row looks like,
  // whether it appears as a preview or as the full filterable table.
  getColumns as taskScoreColumns,
  numericSorter as scoreSorter,
};
