// Several submissions side by side, as the record comparison reads them.
//
// The preset, not the widget: what makes recordComparison.js a comparison of *submissions* —
// two details, and scores read off the submission's own response. A submission has no
// parameters of its own; the model's are the model's.
//
// The compared submissions need not be of one model.

import { loadSubmission } from "../api/submissionApi.js";
import { trainingFieldKeys } from "../schemas/taskSubmissionSchema.js";
import { buildVisibleBadge } from "../components/badges.js";
import { createRecordComparison } from "./recordComparison.js";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

// Also the submissions list's cap, and the compare page's. The palette is sized for six.
const MAX_SUBMISSIONS = 6;

// ─── DETAILS ─────────────────────────────────────────────────────────────────

const MODEL = "model_name";
const VISIBILITY = "is_public";

// Both off the picked row rather than the fetched detail, so the panel is filled before the
// first request lands.
const DETAILS = {
  attributes: () => [
    { key: MODEL, label: "Model" },
    { key: VISIBILITY, label: "Visibility" },
  ],

  cells: (pick) => ({
    [MODEL]: { value: pick.modelName ?? null },

    // `value` is what decides whether the row recedes when every submission agrees, so it
    // carries the fact and `html` the badge.
    [VISIBILITY]: {
      value: pick.isPublic == null ? null : String(pick.isPublic),
      html: buildVisibleBadge(pick.isPublic, "sm"),
    },
  }),
};

// ─── SCORES ──────────────────────────────────────────────────────────────────

// One score per task, with the ids a task panel is opened by and the methodology the plot
// tooltips print. At most one run per task, so nothing to collapse.
//
// A task still being scored is left out rather than carried as a gap.
function toSubmissionScores(pick) {
  const detail = pick.detail;

  if (!detail) return null;

  return Object.fromEntries(
    (detail.task_submissions ?? [])
      .filter((task) => task.score?.primary_metric_mean != null)
      .map((task) => [
        task.task_id,
        {
          mean: task.score.primary_metric_mean,
          sem: task.score.primary_metric_sem ?? null,
          metric: task.score.primary_metric ?? null,

          // What the task panel fetches the per-recording breakdown by.
          task_submission_id: task.id,
          submission_id: pick.key,

          ...Object.fromEntries(
            trainingFieldKeys().map((key) => [key, task[key] ?? null]),
          ),
        },
      ]),
  );
}

// ─── PICKS ───────────────────────────────────────────────────────────────────

// For a host whose rows came from toSubmissionRows. The model's name rides along for the
// details panel and for naming a score where a task is opened out.
function toSubmissionPick(row) {
  return {
    key: row.id,
    name: row.label,
    modelName: row.model_name,
    submissionLabel: row.label,
    isPublic: row.is_public ?? null,
  };
}

// ─── WIDGET ──────────────────────────────────────────────────────────────────

/**
 * A record comparison of submissions.
 *
 * @param options as createRecordComparison.
 * @returns the comparison — see createRecordComparison.
 */
function createSubmissionComparison(options) {
  return createRecordComparison({
    noun: "submission",
    max: MAX_SUBMISSIONS,
    details: DETAILS,

    toPick: toSubmissionPick,

    // The one response carrying the task runs with their methodology. It carries the
    // per-recording breakdown too, which nothing here draws.
    loadDetail: (pick) => loadSubmission(pick.key),

    readScores: toSubmissionScores,

    ...options,
  });
}

export { MAX_SUBMISSIONS, createSubmissionComparison };
