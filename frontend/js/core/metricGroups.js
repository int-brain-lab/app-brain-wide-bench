// Tasks grouped by the metric they are scored in, within their suite.
//
// A suite's mean used to be taken across all its tasks, which for TS1 averages `bacc` with
// `r2` and `poisson_d2`. Those don't share a scale or a chance level: 0.5 bacc is chance on
// a binary readout, while 0.5 r2 is a strong result. The mean was arithmetic on
// incommensurable numbers, and it silently weighted each metric by how many tasks carry it.
//
// Grouping by (suite, metric) makes every mean a mean of one metric. TS2 and TS3 are
// unaffected — each already has a single metric — and TS1 becomes three columns:
//
//   ts1:bacc          choice, reward, stimulus_contrast
//   ts1:poisson_d2    licking_rate
//   ts1:r2            left_paw_speed, right_paw_speed, wheel_speed, whisker_motion_energy
//   ts2:poisson_d2    co_smoothing, forecasting
//   ts3:macro/f1-score  cosmos
//
// Built from GET /api/tasks rather than from the rows on screen, for the same reason
// SUITE_OPTIONS is built from SUITES: a column shouldn't disappear exactly when nothing has
// been scored in it, and the task table is the authority on which metric a task uses.

import { SUITES } from "./suites.js";

// ":" because a task id already contains "-" — `ts1-choice` — so a key built with a hyphen
// would be ambiguous with one, and Tabulator field names have to survive being parsed by
// eye when a sort or a column lookup goes wrong.
const GROUP_SEPARATOR = ":";

function groupKey(suite, metric) {
  return `${suite}${GROUP_SEPARATOR}${metric}`;
}

/**
 * @param tasks the GET /api/tasks payload.
 * @returns [{ key, suite, metric, label, taskIds }] in suite order, then by metric name.
 *          `key` is what a row's field and a column's field are named.
 */
function toMetricGroups(tasks) {
  const groups = new Map();

  for (const task of tasks ?? []) {
    const { task_suite: suite, primary_metric: metric, id } = task;

    if (!suite || !metric) continue;

    const key = groupKey(suite, metric);

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        suite,
        metric,
        label: `${suite.toUpperCase()} ${metric}`,
        taskIds: [],
      });
    }

    groups.get(key).taskIds.push(id);
  }

  // SUITES order rather than alphabetical, so the columns read ts1, ts2, ts3 the way every
  // other suite list in the app does. A suite the constant doesn't know sorts last rather
  // than being dropped.
  return [...groups.values()].sort((a, b) => {
    const suiteOrder = SUITES.indexOf(a.suite) - SUITES.indexOf(b.suite);

    return suiteOrder !== 0 ? suiteOrder : a.metric.localeCompare(b.metric);
  });
}

/**
 * The suites, for the rank columns and the select above them.
 *
 * Ranks group by suite where scores group by (suite, metric), and the asymmetry is the
 * point: a rank is unitless, so averaging TS1's bacc, poisson_d2 and r2 ranks into one TS1
 * figure is legitimate arithmetic, while averaging their scores is not. So the reader gets
 * three rank columns over five score columns — the coarser summary where it is sound, the
 * finer breakdown where it has to be.
 *
 * @returns [{ suite, key, label, taskIds }] in SUITES order. `key` is the row field the
 *          rank is written to — `ts1_rank`, unambiguous against a task id (`ts1-choice`)
 *          and a group key (`ts1:bacc`).
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
        label: `${suite.toUpperCase()} rank`,
        taskIds: [],
      });
    }

    suites.get(suite).taskIds.push(id);
  }

  return [...suites.values()].sort((a, b) => SUITES.indexOf(a.suite) - SUITES.indexOf(b.suite));
}

// Every task, ordered as its group is and then by id, for a control that lists tasks
// individually. From the task table for the same reason the groups are.
function toTaskOptions(groups) {
  return groups.flatMap(group =>
    [...group.taskIds].sort().map(taskId => ({ value: taskId, label: taskId })),
  );
}


export {
  GROUP_SEPARATOR,
  groupKey,
  toMetricGroups,
  toSuiteGroups,
  toTaskOptions,
};
