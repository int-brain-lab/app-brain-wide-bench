// Several records across the tasks of one suite, as bars.
//
// One plot per task: two tasks are two results, not two readings of one. Tasks measured the
// same way still share a y range — see yRangeKeyOf in comparisons/compareData.js.

import { taskLabel } from "../core/suites.js";
import { WEIGHTED, arrangePlots, withRanges } from "./figure.js";
import { createBarPlot } from "./bar.js";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

// A grid of task-wide tracks, so a task is the same width whether one is selected or eleven.
const ARRANGEMENT = {
  ...WEIGHTED,
  height: 220,
  xTickLabel: taskLabel,
};

// ─── SERIES ──────────────────────────────────────────────────────────────────

/**
 * One record's score on one task, as a plot series.
 *
 * @param record       a compared record — see toRecord in comparisons/compareData.js.
 * @param task         `{ taskId, metric }` — see scoredTasksIn.
 * @param valueOf      (record, taskId) => `{ mean, sem }`, or null for nothing to show.
 * @param yAxisLabelOf (metric) => what the y axis is called.
 * @returns the series.
 */
function toModelSeries(record, task, { valueOf, yAxisLabelOf }) {
  const value = valueOf(record, task.taskId);

  return {
    colour: record.colour,
    label: record.name,
    metric: yAxisLabelOf(task.metric || "score"),
    index: new Map([[task.taskId, 0]]),
    values: {
      mean: [value?.mean ?? null],
      sem: [value?.sem ?? null],
    },
  };
}

// ─── PLOTS ───────────────────────────────────────────────────────────────────

/**
 * A plot per task, a bar per record.
 *
 * @param records     the compared records, in pick order.
 * @param scoredTasks from scoredTasksIn — one plot each, in grid order.
 * @param mode        from compareData — what a bar measures, what its axis is called, which
 *                    record to leave out, and which plots share a y range.
 * @returns { element, charts } — as arrangePlots.
 */
function createModelsByTask({ records, scoredTasks, mode }) {
  const plots = withRanges(
    scoredTasks.map((task) => ({
      axis: task.taskId,
      name: null,
      categories: [task.taskId],
      yRangeKey: mode.yRangeKeyOf(task),
      series: records
        .filter((record) => record.key !== mode.skip)
        .map((record) => toModelSeries(record, task, mode)),
    })),
  );
  return arrangePlots({ ...ARRANGEMENT, plots, createPlot: createBarPlot });
}

export { createModelsByTask };
