// A task submission as the pages read it: its rows, the filters over them, and the suite
// a task belongs to.

import { suiteFromTask } from "../core/suites.js";
import { trainingFieldKeys } from "../schemas/taskSubmissionSchema.js";
import { getTaskScoreFilters } from "./taskScoreUtils.js";

// ─── ROWS ────────────────────────────────────────────────────────────────────

// The methodology fields are spread onto the row rather than nested, because a Tabulator
// column addresses its value by a flat `field` name.
//
// `submission_id` rides along unused by any column: the Task link needs both ids, and
// a formatter can only reach what's on the row.
function toTaskSubmissionRow(submission, taskSubmission) {
  const parameters = Object.fromEntries(
    trainingFieldKeys().map((key) => [key, taskSubmission[key]]),
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
function toTaskSubmissionRows(
  submission,
  taskSubmissions = submission.task_submissions ?? [],
) {
  return taskSubmissions.map((taskSubmission) =>
    toTaskSubmissionRow(submission, taskSubmission),
  );
}

// ─── STANDING ────────────────────────────────────────────────────────────────

/**
 * Stamp each row with whether the model is still standing on it.
 *
 * The breakdown names the entry the model currently stands on for each task — the newest
 * scored one this reader may see, which counts private runs for a member and only public
 * ones for anybody else. An entry that is not the named one has been overtaken.
 *
 * Not a ranking: no other model's scores are involved, and no position is reported.
 *
 * @param rows      from toTaskSubmissionRows.
 * @param breakdown the GET /api/models/{id}/breakdown payload, or nothing.
 *
 * @returns copies, each with `latest` — true where the model stands on this entry, and null
 *          where the breakdown is missing and there is nothing to say either way.
 */
function markStandingRows(rows, breakdown) {
  const entries = breakdown?.tasks;

  return rows.map((row) => ({
    ...row,
    latest: entries ? entries[row.task_id]?.task_submission_id === row.id : null,
  }));
}

// ─── FILTERS ─────────────────────────────────────────────────────────────────

// The score tables' own set: one submission's tasks are its scores read another way, so a
// reader asks the same questions of both and the two bars look alike. The rows carry the
// fields it matches on — `task_id`, `suite`, `metric` and the methodology — which is what
// lets one builder serve either.
//
// No model control: every row here belongs to the submission the page is about.
function getTaskSubmissionFilters(rows) {
  return getTaskScoreFilters(rows);
}

// ─── SUITES ──────────────────────────────────────────────────────────────────

function suiteSiblings(submission, taskSubmission) {
  const suite = suiteFromTask(taskSubmission.task_id);

  return (submission.task_submissions ?? []).filter(
    (sibling) => suiteFromTask(sibling.task_id) === suite,
  );
}

// A suite-wide save writes rows the page still holds at their old values, and the tasks and
// scores views render from that same array — so the response is merged back in place rather
// than only into the edited record.
function mergeUpdated(submission, updated) {
  for (const row of updated) {
    const existing = (submission.task_submissions ?? []).find(
      (task) => task.id === row.id,
    );

    if (existing) Object.assign(existing, row);
  }
}

export {
  getTaskSubmissionFilters,
  markStandingRows,
  mergeUpdated,
  suiteSiblings,
  toTaskSubmissionRows,
};
