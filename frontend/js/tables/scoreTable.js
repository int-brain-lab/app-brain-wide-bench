// Filterable task-score table: one row per scored task, across however many submissions
// the caller passes in. Rows, columns and controls only — the table plumbing is in
// table.js.

import { suiteFromTask } from "../core/suites.js";
import {
  SUITE_OPTIONS,
  createFilterableTable,
  previewRows,
  renderStaticTable,
  resolveContainer,
  matchEquals,
  matchIncludes,
  optionsFromRows,
} from "./table.js";
import {
  linkFormatter,
  metricsBadgeFormatter,
  numericSorter,
  scoreSemFormatter,
  suiteBadgeFormatter,
  taskScoreLinkFormatter,
} from "./formatters.js";


// ─── ROWS ───────────────────────────────────────────────────────────────────

// A task submission read through GET /api/users/me/task-submissions already names the
// submission and model it belongs to; the same task read through a submission or model
// detail is nested inside that context instead. Lifting the nested shape into the flat one
// leaves a single row builder for both.
function flattenSubmissions(submissions) {
  return submissions.flatMap(submission =>
    (submission.task_submissions ?? []).map(taskSubmission => ({
      ...taskSubmission,
      submission_id: submission.id,
      submission_name: submission.label,
      // Absent on a model *detail* response's submissions, so a caller flattening several
      // models attaches them itself before calling in.
      model_id: submission.model_id,
      model_name: submission.model_name,
    }))
  );
}

function toScoreRow(result) {
  return {
    id: result.id,
    task_id: result.task_id,
    task_name: result.task_id,
    suite: suiteFromTask(result.task_id),
    submission_id: result.submission_id ?? null,
    submission_label: result.submission_name ?? null,
    model_id: result.model_id ?? null,
    model_name: result.model_name ?? null,
    // All three null on a task that isn't scored yet. `sem` is nullable even on a scored
    // one — a single-seed run has a mean but no spread.
    mean_score: result.score?.primary_metric_mean ?? null,
    sem: result.score?.primary_metric_sem ?? null,
    metric: result.score?.primary_metric ?? null,
  };
}

// For records that nest their tasks — a submission detail, or a model detail's
// submissions.
function toScoreRows(submissions) {
  return flattenSubmissions(submissions).map(toScoreRow);
}

// For GET /api/users/me/task-submissions, which is already one task per row.
function toScoreResultRows(results) {
  return (results ?? []).map(toScoreRow);
}


// ─── COLUMNS ────────────────────────────────────────────────────────────────

// `showSubmission` off drops the Submission column, for a caller already scoped to one
// submission — there it would repeat the page's own heading down every row.
function getScoreColumns({ showSubmission = true, showModel = false } = {}) {
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
      // The task name is the way in to the per-recording, per-metric breakdown of its score
      // — see taskScoreLinkFormatter. An unscored row has nothing behind it and stays plain.
      title: "Task",
      field: "task_name",
      formatter: taskScoreLinkFormatter,
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
      // Mean and sem in one cell — see scoreSemFormatter. The field stays `mean_score` so
      // the sort is on the number, not on the spread printed beside it.
      title: "Score",
      field: "mean_score",
      formatter: scoreSemFormatter("sem"),
      sorter: numericSorter,
      width: 150,
    },
    {
      title: "Metric",
      field: "metric",
      formatter: metricsBadgeFormatter,
      headerSort: false,
    },
  ];
}


// ─── CONTROLS ───────────────────────────────────────────────────────────────

// `suite` is a single value per row here, not the array the submission and model tables
// carry, so it matches with matchEquals rather than matchInArray.
function getScoreControls(rows, { showSubmission = true, showModel = false } = {}) {
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


// ─── TABLE ──────────────────────────────────────────────────────────────────

/**
 * @param container   element, or the id of one. Its contents are replaced.
 * @param rows        rows from toScoreRows (records nesting their tasks) or
 *                    toScoreResultRows (already-flat task submissions).
 * @param showSubmission  keep the Submission column and its filter. Pass false when
 *                    every row belongs to the same submission.
 * @param showModel   add the Model column and its filter. For rows spanning models.
 * @returns the Tabulator instance.
 */
function renderTaskScoresTable({
  container,
  rows,
  showSubmission = true,
  showModel = false,
}) {
  const shown = { showSubmission, showModel };

  return createFilterableTable({
    container,
    rows,
    columns: getScoreColumns(shown),
    controls: getScoreControls(rows, shown),
    noun: "task",
    initialSort: [{ column: "mean_score", dir: "desc" }],
    caller: "renderTaskScoresTable",
  });
}


// ─── STATIC TABLE ───────────────────────────────────────────────────────────

/**
 * Plain-markup counterpart to renderTaskScoresTable, for a fixed preview — no filters,
 * no paging, and no Tabulator needed on the page.
 *
 * @param container   element, or the id of one. Its contents are replaced.
 * @param rows        as renderTaskScoresTable.
 * @param showSubmission  as renderTaskScoresTable.
 * @param showModel   as renderTaskScoresTable.
 * @param limit       how many rows to show. Omit for all of them.
 * @param viewAll     as renderStaticTable — where the footer's "View all" link goes.
 * @returns every row it was given, not just the slice it rendered. The total is already
 *          in the footer; this is for a caller that needs the rows themselves.
 */
function renderStaticTaskScoresTable({
  container,
  rows,
  showSubmission = true,
  showModel = false,
  limit,
  viewAll,
}) {
  const shown = previewRows(rows, (a, b) => numericSorter(b.mean_score, a.mean_score), limit);

  resolveContainer(container, "renderStaticTaskScoresTable").innerHTML = renderStaticTable({
    columns: getScoreColumns({ showSubmission, showModel }),
    rows: shown,
    noun: "task",
    total: rows.length,
    viewAll,
  });

  return rows;
}


export {
  renderTaskScoresTable,
  renderStaticTaskScoresTable,
  toScoreRows,
  toScoreResultRows,
};
