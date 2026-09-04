// Several submissions side by side, as the record comparison reads them.
//
// The preset, not the widget: the tabs, the plots, the differences and the task panel are
// recordComparison.js, and this is only what makes them a comparison of *submissions*.
//
// Two things differ from the model preset. The details panel is two lines rather than nine —
// which model a submission was made with, and whether anyone can read it — because a
// submission has no parameters of its own; the model's are the model's. And the scores come
// off the submission's own detail response rather than a breakdown endpoint: a submission is
// one set of task entries, so there is nothing to collapse and no "newest" to pick.
//
// Submissions of different models compare perfectly well — which is the reason the model's
// name is the first thing the details panel says.

import { createRecordComparison } from "./recordComparison.js";
import { buildVisibleBadge } from "../components/badges.js";
import { loadSubmission } from "../api/submissionApi.js";
import { trainingFieldKeys } from "../schemas/taskSubmissionSchema.js";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

// Also the submissions list's cap, and the compare page's. The palette is sized for six.
const MAX_SUBMISSIONS = 6;

// ─── DETAILS ─────────────────────────────────────────────────────────────────

const MODEL = "model_name";
const VISIBILITY = "is_public";

// Both read off the row the submission was picked in rather than off its detail, so the panel
// is filled before the first request lands — a listing carries them, and neither can change
// while the comparison is open.
const DETAILS = {
  attributes: () => [
    { key: MODEL, label: "Model" },
    { key: VISIBILITY, label: "Visibility" },
  ],

  cells: (entry) => ({
    [MODEL]: { value: entry.modelName ?? null },

    // The badge every other reading of a submission wears for this, so the answer looks the
    // same wherever it is given. `value` is what decides whether the row recedes when every
    // submission agrees, so it is the fact rather than the markup.
    [VISIBILITY]: {
      value: entry.isPublic == null ? null : String(entry.isPublic),
      html: buildVisibleBadge(entry.isPublic, "sm"),
    },
  }),
};

// ─── SCORES ──────────────────────────────────────────────────────────────────

// The submission's own task entries, in the shape the comparison reads: one score per task,
// with the ids a task panel is opened by and the methodology the plot tooltips print.
//
// No collapse and no "latest": a submission is one attempt, so it has at most one entry per
// task, where a model's breakdown has to pick between the several it has accumulated.
//
// A task still being scored has no score to show and is left out rather than carried as a
// gap: the axis is the union across the compared submissions, so a task nobody has scored
// simply isn't on it.
function toSubmissionScores(entry) {
  const detail = entry.detail;

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
          submission_id: entry.recordId,

          ...Object.fromEntries(
            trainingFieldKeys().map((key) => [key, task[key] ?? null]),
          ),
        },
      ]),
  );
}

// ─── ENTRIES ─────────────────────────────────────────────────────────────────

// For a host whose rows came from toSubmissionRows. The label is the record's name, and the
// model's name rides along for the details panel — and for naming a score of this submission
// where a task is opened out, which wants both.
function toSubmissionEntry(row) {
  return {
    key: row.id,
    recordId: row.id,
    name: row.label,
    teamName: row.team_name,
    modelName: row.model_name,
    submissionLabel: row.label,
    isPublic: row.is_public ?? null,
  };
}

// ─── WIDGET ──────────────────────────────────────────────────────────────────

/** @param rest as createRecordComparison. */
function createSubmissionComparison(options) {
  return createRecordComparison({
    noun: "submission",
    max: MAX_SUBMISSIONS,
    details: DETAILS,

    toEntry: toSubmissionEntry,

    // The whole submission, which is the one response carrying its task entries with their
    // methodology. It carries the per-recording breakdown too, which nothing here draws — the
    // task panel asks for that one entry at a time — but there is no lighter shape to ask for.
    loadDetail: (entry) => loadSubmission(entry.recordId),

    scoresOf: toSubmissionScores,

    ...options,
  });
}

export { MAX_SUBMISSIONS, createSubmissionComparison };
