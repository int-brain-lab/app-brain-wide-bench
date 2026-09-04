// Shaping for the comparison page: several models' scores on one suite, as a matrix.
//
// The output is table-shaped — one row per task, one field per model id — so the two grids
// in compareTable.js bind to it with no reshaping. Tasks are the rows because a suite has
// many more tasks than a comparison has models, which also makes the metric a property of
// the row and filtering by it a plain row filter.
//
// Four rules the page depends on:
//
//   1. A task's score is the *latest* submitted for it, never the best, and latest per
//      task — the same collapse app/ranking/rank.py does before ranking, which is what lets a
//      rank sit beside a score. Who did the collapsing is the host's business: a page holding
//      a leaderboard response already has it done, and one holding model details has
//      latestScoresByTask below.
//   2. A missing score is `null`, not `0`, so an unattempted suite doesn't drag a mean down.
//   3. The task rows are the *union* across the models compared, not the selected model's
//      own. A comparator scoring something it never attempted shows as "—" in its column.
//   4. A model's mean is over the tasks it actually scored, so `scored`/`total` travel
//      alongside for the overview's coverage.

import { mean } from "../core/utils.js";
import { suiteFromTask } from "../core/suites.js";

// ─── LATEST ──────────────────────────────────────────────────────────────────

// Each task takes its score from the newest submission that scored it, so a model is read
// as where it currently stands rather than as its most recent upload.
//
// For a caller holding model details, which carry every submission. A leaderboard response
// arrives collapsed already, and by the server's own reckoning: ordered by
// `(has_date, date, id)` over completed submissions, where this reads `created_at` alone and
// takes any submission with a score on it. The two agree on everything but a timestamp tie
// and a submission still being scored.
function latestScoresByTask(submissions) {
  const latest = new Map();

  for (const submission of submissions ?? []) {
    // NaN on an absent or unparseable date, which `|| 0` turns into "oldest" — otherwise
    // every comparison against it is false and the task keeps whichever score came first.
    const at = Date.parse(submission.created_at ?? 0) || 0;

    for (const { task_id, score } of submission.task_submissions ?? []) {
      if (score?.primary_metric_mean == null) continue;

      const held = latest.get(task_id);

      if (held && held.at >= at) continue;

      latest.set(task_id, {
        at,
        mean: score.primary_metric_mean,
        // Nullable on a scored task too — a single-seed run has a mean but no spread.
        sem: score.primary_metric_sem ?? null,
        metric: score.primary_metric ?? null,
      });
    }
  }

  return Object.fromEntries(
    [...latest].map(([taskId, { mean, sem, metric }]) => [
      taskId,
      { mean, sem, metric },
    ]),
  );
}

// ─── ENTRIES ─────────────────────────────────────────────────────────────────

// One record — a model, a submission — reduced to its scores.
//
// `entry` is a comparison entry: it already knows the record's name and team, from the row it
// was picked in, so neither is waited on. `scores` is `{ task_id: { mean, sem, metric } }`,
// whoever collapsed it: a leaderboard row's `scores` and latestScoresByTask agree on those
// three fields, and anything else a producer carries rides along unread.
//
// `recordId` and `recordName` rather than `modelId` and `modelName`: what is being compared is
// whatever the host picked, and the shape below is the same for a model, a submission, or the
// next thing with a score per task.
//
// `suite` narrows them to one; omit it for every task the model has scored, which is what a
// comparison shows until the reader asks for less.
function toCompareEntry(entry, scores, suite = "") {
  const tasks = Object.fromEntries(
    Object.entries(scores ?? {}).filter(
      ([taskId]) => !suite || suiteFromTask(taskId) === suite,
    ),
  );

  return {
    recordId: entry.recordId,
    recordName: entry.name,
    teamName: entry.teamName ?? null,
    // { "ts1-choice": { mean, sem, metric }, … }
    tasks,
    mean: mean(Object.values(tasks).map((task) => task.mean)),
    scored: Object.keys(tasks).length,
  };
}

/**
 * @param entries    comparison entries, in the order they were picked.
 * @param scoresOf   (entry) => its scores. Read here rather than held on the entry because
 *                   an entry outlives the data behind it: the leaderboard refetches its
 *                   board under the picks, and the selection keeps the entry object it
 *                   already had.
 * @param suite      which suite to narrow to, or "" for all of them.
 * @param selectedId the record being compared *against*, which is badged rather than moved.
 * @returns one entry per record, in the order given. Pick order rather than ranked: a mean
 *          over a mixed set of metrics is not a ranking, and the reader chose the order the
 *          picker is in. A model with no score on the suite is kept — it was explicitly
 *          chosen, and silently omitting it would read as a bug in the picker.
 */
function toCompareEntries(entries, scoresOf, suite, selectedId) {
  return entries
    .map((entry) => toCompareEntry(entry, scoresOf(entry), suite))
    .map((entry) => ({ ...entry, isSelected: entry.recordId === selectedId }));
}

// ─── TASKS ───────────────────────────────────────────────────────────────────

/**
 * The union of scored tasks across `entries`, sorted by id, each with the metric it is
 * measured in.
 *
 * The metric comes from whichever entry scored the task first — it is a property of the
 * task, not of the model, so any of them answers the same. Taken from the scores rather
 * than GET /api/tasks so the page needs no second source of truth for what it is already
 * displaying.
 */
function compareTasks(entries) {
  const metrics = new Map();

  for (const entry of entries) {
    for (const [taskId, task] of Object.entries(entry.tasks)) {
      if (!metrics.has(taskId)) metrics.set(taskId, task.metric);
    }
  }

  return [...metrics]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([taskId, metric]) => ({ taskId, metric }));
}

// ─── MODES ───────────────────────────────────────────────────────────────────
//
// What a cell means, which is the only thing separating the two grids and the two charts:
// one reads a model's score on a task, the other reads how far it is from the baseline's.
// Written once, because the grid and the chart drawing the same comparison differently must
// not be able to disagree about it.
//
// A mode is `{ valueOf, axisTitle, skip }`:
//
//   valueOf(entry, taskId)  the cell, as `{ mean, sem }`, or null for nothing to show
//   axisTitle(metric)       what the y axis of that metric's plot is called
//   skip                    a model id to leave out of the columns and the series

function scoreMode() {
  return {
    valueOf: (entry, taskId) => entry.tasks[taskId] ?? null,
    axisTitle: (metric) => metric,
    skip: null,
  };
}

/**
 * @param baselineId whichever record the reader is measuring against, which is the page's own
 *                   by default but may be any of the compared ones — "how much better is
 *                   everything than mine?" and "how much better is mine than this one?" are
 *                   the same comparison read two ways. It gets no column and no series of
 *                   its own: it would be a row of zeros.
 */
function diffMode(entries, baselineId) {
  const baseline = entries.find((entry) => entry.recordId === baselineId);

  return {
    // A task only one of the two scored has no difference to state, so the cell is empty
    // rather than the raw score — a number here and "—" in the grid above would read as a
    // gap of exactly that size.
    //
    // No sem, and deliberately: the spread of a difference is not either model's, and the
    // usual √(s₁² + s₂²) would assume the two were measured independently when they were
    // scored on the same recordings.
    valueOf: (entry, taskId) => {
      const other = entry.tasks[taskId];
      const against = baseline?.tasks[taskId];

      return other && against
        ? { mean: other.mean - against.mean, sem: null }
        : null;
    },
    axisTitle: (metric) => `Δ ${metric}`,
    skip: baselineId,
  };
}

// ─── ROWS ────────────────────────────────────────────────────────────────────

// One row per record, in the order they should appear: the page's own first, then by
// mean descending — the order toCompareEntries already put them in. `skip` leaves out the
// difference grid's baseline, which would be a row of zeros.
//
// Tabulator binds a column to a field name, so each task id becomes a field. The value is the
// whole { mean, sem } object rather than a number — the cell renders both halves, and a sorter
// reading `.mean` is cheaper than carrying a parallel set of fields.
//
// The record's own fields ride along because the row identifies itself: its name, its team and
// the colour it is drawn in everywhere else.
function toCompareRows(entries, tasks, { valueOf, skip = null }) {
  return entries
    .filter((entry) => entry.recordId !== skip)
    .map((entry) => ({
      recordId: entry.recordId,
      recordName: entry.recordName,
      teamName: entry.teamName,
      isSelected: entry.isSelected,
      colour: entry.colour,
      ...Object.fromEntries(
        tasks.map(({ taskId }) => [taskId, valueOf(entry, taskId)]),
      ),
    }));
}

export {
  compareTasks,
  diffMode,
  latestScoresByTask,
  scoreMode,
  toCompareEntries,
  toCompareEntry,
  toCompareRows,
};
