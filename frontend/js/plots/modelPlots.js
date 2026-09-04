// Several models across the tasks of one suite: the comparison's two grids, as bars.
//
// The domain half again — compareTable.js turns the same entries and the same mode into rows
// and columns, this turns them into series, and figure.js arranges them. A mark is one model's score on
// one task, with the sem the grid prints after the ± as its whisker.
//
// Models are the series, which is the grid transposed: a comparison has at most five of them,
// so this is five things to tell apart by colour rather than a dozen tasks to tell apart by
// position. It also means a model keeps one colour across every panel — a plot, a grid cell
// and the board row it was picked in are all the same ink.
//
// Bars rather than dots, because there are few enough tasks to give each a group of them,
// and a length read against a common baseline answers "by how much" faster than two
// positions do. The axis therefore includes zero — createBarPlot sees to that — so the
// height of a bar stays proportional to what it reports.
//
// One plot per task, not one per metric. Two tasks are two results, not two readings of one:
// "choice" and "wheel speed" both being measured in r2 doesn't make them a scale a reader
// runs their eye along, and an axis holding a suite's eight was eight results deep in one
// picture. A plot each gives every task its own axis, its own tick label and room for the
// group of bars that answers the question actually being asked of it — how these models
// compare *on this task*.
//
// They still share a y range with the tasks measured the same way, which a plot per task
// would otherwise lose: see `scaleKey` in figure.js and scaleOf below. Autoscaled apart,
// adjacent plots would draw 0.1 and 0.9 at the same height.
//
// Those plots sit in a row rather than stacked — read across rather than down, and wrapping
// once a line is full, so eleven tasks are one figure rather than a page of them. Each is one
// track of the page's own grid — see CATEGORIES_PER_LINE in figure.js — so a task's plot is
// the same width whatever else is on screen, and each carries its own tick labels, since its
// task is its own.

import { suiteFromTask, taskLabel } from "../core/suites.js";
import { methodologyLines } from "../components/methodologyGrid.js";
import { TASK_FIELDS } from "../schemas/taskSubmissionSchema.js";
import { createBarPlots } from "./bar.js";

// Titling the axis and keying the scale both go through it, so a task whose score never
// named its metric is drawn against the others like it rather than alone on a scale called
// nothing.
function metricOf(task) {
  return task.metric || "score";
}

// What a task's plot shares its y range with: the suite's other tasks measured in the same
// metric. The suite as well as the metric, because the same metric on two suites is not one
// scale — ts1's poisson_d2 is a behavioural readout and ts2's is neural reconstruction, and
// one range across both would invite the comparison the numbers don't support.
function scaleOf(task) {
  return `${suiteFromTask(task.taskId) ?? ""}|${metricOf(task)}`;
}


/**
 * One series per model per task: a plot is a task, so a model across eleven of them is eleven
 * series that happen to share a name and a colour.
 *
 * @param mode a mode from compareData — `{ valueOf, axisTitle, skip }`. `skip` is a plain
 *             filter, because a model's colour is carried on its entry rather than taken from
 *             its place in the list.
 */
function toModelSeries(entries, tasks, { valueOf, axisTitle, skip = null }) {
  return tasks.flatMap((task) =>
    entries
      .filter((entry) => entry.recordId !== skip)
      .map((entry) => {
        const value = valueOf(entry, task.taskId);

        return {
          colour: entry.colour,
          label: entry.recordName,
          metric: axisTitle(metricOf(task)),
          // The task both ways round: its own axis, of one category, and a range shared with
          // the tasks it is comparable to.
          group: task.taskId,
          scaleKey: scaleOf(task),
          index: new Map([[task.taskId, 0]]),
          // Nothing to show is a gap rather than a zero, exactly as the grids leave the
          // cell "—" rather than printing a number they don't have.
          values: {
            mean: [value?.mean ?? null],
            sem: [value?.sem ?? null],
          },
        };
      }),
  );
}

// Everything both charts arrange the same way, which is everything except what the bars
// measure. The rest is createBarPlots' own default.
const PLOT = {
  facet: "metric",
  tickLabel: taskLabel,
  // A grid of task-wide tracks, one track per plot: a task is drawn at one track whether the
  // reader is looking at one of them or at eleven, so a bar's width says nothing about how
  // many tasks happen to be selected. A line's worth fill it and the rest wrap.
  layout: "weighted",
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
