// Several models across the tasks of one suite: the comparison's two grids, as bars.
//
// The domain half again — compareTable.js turns the same entries and the same mode into rows
// and columns, this turns them into series, and figure.js arranges them. A mark is one model's score on
// one task, with the sem the grid prints after the ± as its whisker.
//
// Models are the series and tasks the axis, which is the grid transposed: a comparison has
// at most five models and a suite has a dozen tasks, so this is five things to tell apart
// against a dozen positions rather than the other way round. It also means a model keeps
// one colour across every panel.
//
// Bars rather than dots, because there are few enough tasks to give each a group of them,
// and a length read against a common baseline answers "by how much" faster than two
// positions do. The axis therefore includes zero — createBarPlot sees to that — so the
// height of a bar stays proportional to what it reports.
//
// The axis is grouped by metric, not merely faceted by it. Two tasks measured differently
// are different tasks — a suite's `bps` tasks and its `d2` tasks are disjoint sets — so each
// metric's plot gets an axis holding only its own, rather than one axis on which every plot
// is mostly gaps.
//
// Those plots sit in a row rather than stacked. A suite has two or three metrics, and they
// are read across — the same models, measured differently — rather than down; stacked, the
// third was below the fold and the comparison stopped looking like one figure. Each plot
// carries its own tick labels, since its tasks are its own — which is createBarPlots' own
// default.

import { suiteFromTask, taskLabel } from "../core/suites.js";
import { createBarPlots } from "./bar.js";

// Grouping and titling both key on it, so a task whose score never named its metric lands
// in one plot rather than in a plot per unnamed metric.
function metricOf(task) {
  return task.metric || "score";
}

// A plot holds one suite's tasks measured in one metric. The suite as well as the metric,
// because the same metric on two suites is not one scale: ts1's poisson_d2 is a behavioural
// readout and ts2's is neural reconstruction, and one axis holding both would invite the
// comparison the numbers don't support.
function plotOf(task) {
  return `${suiteFromTask(task.taskId) ?? ""}|${metricOf(task)}`;
}

/**
 * One series per model per plot: the plots are per suite and metric, and a model spanning two
 * of them is two series that happen to share a name and a colour.
 *
 * @param mode a mode from compareData — `{ valueOf, axisTitle, skip }`. `skip` is a plain
 *             filter, because a model's colour is carried on its entry rather than taken from
 *             its place in the list.
 */
function toModelSeries(entries, tasks, { valueOf, axisTitle, skip = null }) {
  const plots = [...new Set(tasks.map(plotOf))];

  return plots.flatMap((plot) => {
    const held = tasks.filter((task) => plotOf(task) === plot);
    const taskIds = held.map((task) => task.taskId);

    return entries
      .filter((entry) => entry.modelId !== skip)
      .map((entry) => {
        const values = taskIds.map((taskId) => valueOf(entry, taskId));

        return {
          colour: entry.colour,
          label: entry.modelName,
          metric: axisTitle(metricOf(held[0])),
          group: plot,
          index: new Map(taskIds.map((taskId, at) => [taskId, at])),
          // Nothing to show is a gap rather than a zero, exactly as the grids leave the
          // cell "—" rather than printing a number they don't have.
          values: {
            mean: values.map((value) => value?.mean ?? null),
            sem: values.map((value) => value?.sem ?? null),
          },
        };
      });
  });
}

// Everything both charts arrange the same way, which is everything except what the bars
// measure. The rest is createBarPlots' own default.
const PLOT = {
  facet: "metric",
  tickLabel: taskLabel,
  // A suite's metrics cover different numbers of tasks — four measured in r2, one in
  // poisson_d2 — and equal columns would draw one task as wide as four. Weighted, a task's
  // group of bars is the same width wherever it is read.
  layout: "weighted",
  // One key above the row, always, even for one model: the plots are titled by their metric,
  // so nothing else here says which model the marks belong to. Inside each plot it would
  // name the same models once per metric.
  legend: "shared",
};

/**
 * @param entries from compareData's toCompareEntries — the models, in column order.
 * @param tasks   from compareData's compareTasks — the axis, in the grid's row order.
 * @param mode    from compareData — what a bar measures, and what the axis of each metric is
 *                called. What a difference *is* belongs to the domain rather than to the
 *                drawing, so this module never computes one.
 * @param scale   "all" for one y range across every plot, where "metric" keeps one per
 *                metric. Differences are distances from one baseline, so the question a
 *                reader brings to them is how big — and autoscaled apart, a 0.02 gain in one
 *                metric would be drawn the same height as a 0.20 gain in another.
 * @returns { element, charts } — as createBarPlots.
 */
function createModelPlots({ entries, tasks, mode, scale = "metric" }) {
  return createBarPlots({
    ...PLOT,
    scale,
    entries: toModelSeries(entries, tasks, mode),
  });
}

export { createModelPlots };
