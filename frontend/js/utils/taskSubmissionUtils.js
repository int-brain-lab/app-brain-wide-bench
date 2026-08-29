import { suiteFromTask } from "../core/suites.js";
import {
  TASK_FIELDS,
  trainingFieldKeys,
} from "../schemas/taskSubmissionSchema.js";
import {
  matchEquals,
  matchIncludes,
  optionsFromRows,
  SUITE_OPTIONS,
} from "../components/filters.js";

// ─── ROWS ────────────────────────────────────────────────────────────────────

// The methodology fields, taken from TASK_FIELDS' panel 1 rather than listed here, so
// this table and the task editor can't disagree about what "the parameters" are —
// adding a `panel: "methodology"` field to the schema adds a column here automatically.
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
    submission_label: submission.label ?? null,
    model_name: submission.model_name ?? null,
    task_id: taskSubmission.task_id,
    suite: suiteFromTask(taskSubmission.task_id),
    // All three null on a task that isn't scored yet. `sem` is nullable even on a scored
    // one — a single-seed run has a mean but no spread.
    mean_score: taskSubmission.score?.primary_metric_mean ?? null,
    sem: taskSubmission.score?.primary_metric_sem ?? null,
    metric: taskSubmission.score?.primary_metric ?? null,
    ...parameters,
  };
}

// Plural counterpart. The submission is the same for every row — it carries the id the
// edit link needs — so it stays outside the map rather than being repeated per task.
export function toTaskSubmissionRows(
  submission,
  taskSubmissions = submission.task_submissions ?? [],
) {
  return taskSubmissions.map((taskSubmission) =>
    toTaskSubmissionRow(submission, taskSubmission),
  );
}

// ─── FILTERS ─────────────────────────────────────────────────────────────────

export function getTaskSubmissionFilters(rows) {
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
    {
      // optionsFromRows drops nulls, and an unscored row carries no metric — so choosing
      // one narrows to scored rows.
      type: "select",
      name: "metric",
      placeholder: "All metrics",
      options: optionsFromRows(rows, "metric"),
      match: matchEquals("metric"),
    },
  ];
}

// ─── SUITES ──────────────────────────────────────────────────────────────────

export function suiteLabel(taskId) {
  return suiteFromTask(taskId)?.toUpperCase() ?? null;
}

export function suiteSiblings(submission, taskSubmission) {
  const suite = suiteFromTask(taskSubmission.task_id);

  return (submission.task_submissions ?? []).filter(
    (sibling) => suiteFromTask(sibling.task_id) === suite,
  );
}

// A suite-wide save writes rows the page still holds at their old values, and the tasks and
// scores views render from that same array — so the response is merged back in place rather
// than only into the edited record.
export function mergeUpdated(submission, updated) {
  for (const row of updated) {
    const existing = (submission.task_submissions ?? []).find(
      (task) => task.id === row.id,
    );

    if (existing) Object.assign(existing, row);
  }
}
