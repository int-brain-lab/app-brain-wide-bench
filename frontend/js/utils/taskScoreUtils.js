// A task score as the pages read it: its rows and the filters over them.
//
// The panels a score row opens are comparisons/scoreModes.js.

import { suiteFromTask, taskLabel } from "../core/suites.js";
import {
  TASK_FIELDS,
  toMethodologyValues,
  trainingFieldKeys,
} from "../schemas/taskSubmissionSchema.js";
import {
  matchEquals,
  matchInArray,
  matchIncludes,
  optionsFromRows,
  SUITE_OPTIONS,
} from "../components/filters.js";

// ─── ROWS ────────────────────────────────────────────────────────────────────

// A task submission read through GET /api/users/me/task-submissions already names the
// submission and model it belongs to; the same task read through a submission or model
// detail is nested inside that context instead. Lifting the nested shape into the flat one
// leaves a single row builder for both.
function flattenSubmissions(submissions) {
  return submissions.flatMap((submission) =>
    (submission.task_submissions ?? []).map((taskSubmission) => ({
      ...taskSubmission,
      submission_id: submission.id,
      submission_name: submission.label,
      // Absent on a model *detail* response's submissions, so a caller flattening several
      // models attaches them itself before calling in.
      model_id: submission.model_id,
      model_name: submission.model_name,
    })),
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

    // How the task was produced. Absent from a model detail's nested tasks before the API
    // carries it — see app/schemas/models.py.
    ...toMethodologyValues(result),
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

// ─── FILTERS ─────────────────────────────────────────────────────────────────

// Short names, which are unique across the suites, and the suite as the class — so a pinned
// task wears the colour of the suite it came from.
function taskOptions(rows) {
  return [...new Set(rows.map((row) => row.task_id).filter(Boolean))]
    .sort()
    .map((taskId) => ({
      value: taskId,
      label: taskLabel(taskId),
      className: suiteFromTask(taskId),
    }));
}

// How each task was produced: the methodology panel of a task submission, whatever it holds.
// Two of them hold arrays, so what a row is matched by depends on the field.
function getMethodologyFilters() {
  return trainingFieldKeys().map((key) => ({
    type: "pinned",
    name: key,
    label: TASK_FIELDS[key].label,
    options: TASK_FIELDS[key].options ?? [],
    match:
      TASK_FIELDS[key].input === "checkbox-list"
        ? matchInArray(key)
        : matchEquals(key),
  }));
}

/**
 * The filter bar over a set of task-score rows.
 *
 * `suite` is a single value per row here, not the array the submission and model tables
 * carry, so it matches with matchEquals rather than matchInArray.
 *
 * @param rows           every row, so the selects can offer only values that appear.
 * @param showSubmission include the submission select. Off where every row is one
 *                       submission's.
 * @param showModel      include the model select. On where the rows span several models.
 *
 * @returns the controls, in bar order — see components/filterState.js.
 */
function getTaskScoreFilters(
  rows,
  { showSubmission = true, showModel = false, showMethodology = false } = {},
) {
  const modelControl = showModel
    ? [
        {
          type: "pinned",
          name: "model_name",
          label: "Model",
          options: optionsFromRows(rows, "model_name"),
          match: matchEquals("model_name"),
        },
      ]
    : [];

  const submissionControl = showSubmission
    ? [
        {
          type: "select",
          name: "submission_label",
          label: "Submission",
          placeholder: "All submissions",
          options: optionsFromRows(rows, "submission_label"),
          match: matchEquals("submission_label"),
        },
      ]
    : [];

  const methodologyControl = showMethodology ? getMethodologyFilters() : [];

  return [
    {
      type: "pinned",
      name: "suite",
      label: "Suite",
      options: SUITE_OPTIONS,
      match: matchEquals("suite"),
    },
    {
      type: "pinned",
      name: "task_id",
      label: "Task",
      options: taskOptions(rows),
      match: matchEquals("task_id"),
    },
    {
      type: "pinned",
      name: "metric",
      label: "Metric",
      options: optionsFromRows(rows, "metric"),
      match: matchEquals("metric"),
    },
    ...methodologyControl,
    ...modelControl,
    ...submissionControl,
  ];
}

export { getTaskScoreFilters, toScoreResultRows, toScoreRows };
