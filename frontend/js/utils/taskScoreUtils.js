// A task score as the pages read it: its rows and the filters over them.
//
// The panels a score row opens are comparisons/scoreModes.js.

import { suiteFromTask } from "../core/suites.js";
import {
  matchEquals,
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
 * @returns the controls, in bar order — see components/filters.js.
 */
function getTaskScoreFilters(
  rows,
  { showSubmission = true, showModel = false } = {},
) {
  const modelControl = showModel
    ? [
        {
          type: "select",
          name: "model_name",
          placeholder: "All models",
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
          placeholder: "All submissions",
          options: optionsFromRows(rows, "submission_label"),
          match: matchEquals("submission_label"),
        },
      ]
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
    {
      // From the rows rather than a fixed list: which metrics appear depends on which tasks
      // were scored, and an option that hides every row would be the only thing it could
      // do. Unscored rows carry no metric and so contribute none — optionsFromRows drops
      // nulls — which also means choosing any metric narrows to scored rows.
      type: "select",
      name: "metric",
      placeholder: "All metrics",
      options: optionsFromRows(rows, "metric"),
      match: matchEquals("metric"),
    },
    ...modelControl,
    ...submissionControl,
  ];
}

export { getTaskScoreFilters, toScoreResultRows, toScoreRows };
