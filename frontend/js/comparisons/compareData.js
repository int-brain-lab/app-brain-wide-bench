// Shaping for the comparison page: several records' scores on one suite, as a matrix.
//
// The output is table-shaped — one row per record, one field per task id — so the two grids
// in compareTable.js bind to it with no reshaping. Records are the rows because a record is
// the thing being compared; the tasks they are compared over are the columns.
//
// Three rules the page depends on:
//
//   1. A task's score is the *latest* submitted for it, never the best, and latest per
//      task — the same collapse app/ranking/rank.py does before ranking, which is what lets a
//      rank sit beside a score. Who did the collapsing is the host's business: a page holding
//      a leaderboard response already has it done, and one holding model details has
//      latestScoresByTask below.
//   2. A missing score is `null`, not `0`, so an unattempted suite doesn't drag a mean down.
//   3. The task rows are the *union* across the models compared, not the selected model's
//      own. A comparator scoring something it never attempted shows as "—" in its column.

import { suiteFromTask, taskTypeOf } from "../core/suites.js";

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

// ─── RECORDS ─────────────────────────────────────────────────────────────────

// One record — a model, a submission — reduced to its scores.
//
// `pick` carries the key and the name, from the row it was picked in, so neither waits on a
// request. The team comes off the fetched detail instead — every response that backs a
// comparison carries `team_name`, and a team line arriving a beat after the name reads as the
// row filling in rather than as a missing label.
//
// `scores` is `{ task_id: { mean, sem, metric } }`, whoever collapsed it: a leaderboard row's
// `scores` and latestScoresByTask agree on those three fields, and anything else a producer
// carries rides along unread.
//
// `suite` narrows them to one; omit it for every task the record has scored.
function toRecord(pick, scores, suite = "") {
  const tasks = Object.fromEntries(
    Object.entries(scores ?? {}).filter(
      ([taskId]) => !suite || suiteFromTask(taskId) === suite,
    ),
  );

  return {
    key: pick.key,
    name: pick.name,
    teamName: pick.detail?.team_name ?? null,
    // { "ts1-choice": { mean, sem, metric }, … }
    tasks,
  };
}

// ─── TASKS ───────────────────────────────────────────────────────────────────

/**
 * The union of scored tasks across `records`, sorted by id, each with the metric it is
 * measured in.
 *
 * The metric comes from whichever record scored the task first — it is a property of the
 * task, not of the model, so any of them answers the same. Taken from the scores rather
 * than GET /api/tasks so the page needs no second source of truth for what it is already
 * displaying.
 */
function scoredTasksIn(records) {
  const metrics = new Map();

  for (const record of records) {
    for (const [taskId, task] of Object.entries(record.tasks)) {
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
// A mode is `{ valueOf, yAxisLabelOf, skip, yRangeKeyOf }`:
//
//   valueOf(record, taskId)  the cell, as `{ mean, sem }`, or null for nothing to show
//   yAxisLabelOf(metric)     what the y axis of that metric's plot is called
//   skip                     a record key to leave out of the columns and the series
//   yRangeKeyOf(task)        which plots share a y range — see withRanges in plots/figure.js

function scoreMode() {
  return {
    valueOf: (record, taskId) => record.tasks[taskId] ?? null,
    yAxisLabelOf: (metric) => metric,
    skip: null,
    yRangeKeyOf: (task) => `${taskTypeOf(task.taskId)}|${task.metric}`,
  };
}

/**
 * @param baselineId whichever record the reader is measuring against, which is the page's own
 *                   by default but may be any of the compared ones — "how much better is
 *                   everything than mine?" and "how much better is mine than this one?" are
 *                   the same comparison read two ways. It gets no column and no series of
 *                   its own: it would be a row of zeros.
 */
function diffMode(records, baselineId) {
  const baseline = records.find((record) => record.key === baselineId);

  return {
    // A task only one of the two scored has no difference to state, so the cell is empty
    // rather than the raw score — a number here and "—" in the grid above would read as a
    // gap of exactly that size.
    //
    // No sem, and deliberately: the spread of a difference is not either model's, and the
    // usual √(s₁² + s₂²) would assume the two were measured independently when they were
    // scored on the same recordings.
    valueOf: (record, taskId) => {
      const other = record.tasks[taskId];
      const against = baseline?.tasks[taskId];

      return other && against
        ? { mean: other.mean - against.mean, sem: null }
        : null;
    },
    yAxisLabelOf: (metric) => `Δ ${metric}`,
    skip: baselineId,
    // Differences are distances from one baseline, so every plot shares one range.
    yRangeKeyOf: () => "all",
  };
}

// ─── ROWS ────────────────────────────────────────────────────────────────────

// One row per record, in the order given — pick order, never ranked: a mean over a mixed
// set of metrics is not a ranking. `skip` leaves out the difference grid's baseline, which
// would be a row of zeros.
//
// Tabulator binds a column to a field name, so each task id becomes a field. The value is the
// whole { mean, sem } object rather than a number — the cell renders both halves, and a sorter
// reading `.mean` is cheaper than carrying a parallel set of fields.
//
// The record's own fields ride along because the row identifies itself: its name, its team and
// the colour it is drawn in everywhere else.
function toCompareRows(records, scoredTasks, { valueOf, skip = null }) {
  return records
    .filter((record) => record.key !== skip)
    .map((record) => ({
      key: record.key,
      name: record.name,
      teamName: record.teamName,
      isReference: record.isReference,
      colour: record.colour,
      ...Object.fromEntries(
        scoredTasks.map(({ taskId }) => [taskId, valueOf(record, taskId)]),
      ),
    }));
}

export {
  diffMode,
  latestScoresByTask,
  scoreMode,
  scoredTasksIn,
  toCompareRows,
  toRecord,
};
