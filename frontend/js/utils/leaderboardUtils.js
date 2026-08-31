// The leaderboard's columns and controls, read off the task catalogue.
//
// The leaderboard summarises a suite by the mean of its *ranks*, never by the mean of its
// scores. TS1 alone carries `bacc`, `poisson_d2` and `r2`, which share neither a scale nor
// a chance level — 0.5 bacc is chance on a binary readout, while 0.5 r2 is a strong result
// — so a suite-level score would be arithmetic on incommensurable numbers, silently
// weighted by how many tasks happen to carry each metric. A rank is unitless, so a mean of
// ranks across metrics is a summary that holds.
//
// That is the whole asymmetry: three rank columns at suite grain, and scores shown one task
// at a time, labelled with the metric they are in.
//
// Built from GET /api/tasks rather than from the rows on screen: a column shouldn't
// disappear exactly when nothing has been scored in it, and the task table is the authority
// on which metric a task uses.

import { SUITES, suiteLabel } from "../core/suites.js";

// ─── COLUMNS ─────────────────────────────────────────────────────────────────

/**
 * The suites, for the rank columns and the select above them.
 *
 * @returns [{ suite, key, label, taskIds }] in SUITES order. `key` is the row field the
 *          rank is written to — `ts1_rank`, unambiguous against a task id (`ts1-choice`).
 */
function toSuiteGroups(tasks) {
  const suites = new Map();

  for (const task of tasks ?? []) {
    const { task_suite: suite, id } = task;

    if (!suite) continue;

    if (!suites.has(suite)) {
      suites.set(suite, {
        suite,
        key: `${suite}_rank`,
        label: `${suiteLabel(suite)} rank`,
        taskIds: [],
      });
    }

    suites.get(suite).taskIds.push(id);
  }

  // SUITES order rather than alphabetical, so the columns read ts1, ts2, ts3 the way every
  // other suite list in the app does. A suite the constant doesn't know sorts last rather
  // than being dropped.
  return [...suites.values()].sort(
    (a, b) => SUITES.indexOf(a.suite) - SUITES.indexOf(b.suite),
  );
}

// `{ taskId: metric }` — what a single task's score column is measured in, so the header can
// say so. The leaderboard payload carries the metric on each score too; this is read off the
// task table instead, which knows it whether or not anyone has been scored yet.
function toTaskMetrics(tasks) {
  return Object.fromEntries(
    (tasks ?? [])
      .filter((task) => task.id && task.primary_metric)
      .map((task) => [task.id, task.primary_metric]),
  );
}

// ─── CONTROLS ────────────────────────────────────────────────────────────────

// Every task, ordered by suite and then by id, for a control that lists tasks
// individually.
function toTaskOptions(suites) {
  return suites.flatMap((suite) =>
    [...suite.taskIds]
      .sort()
      .map((taskId) => ({ value: taskId, label: taskId })),
  );
}

export { toSuiteGroups, toTaskMetrics, toTaskOptions };
