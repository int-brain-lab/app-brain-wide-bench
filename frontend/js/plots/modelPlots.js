// Several models across the tasks of one suite: the comparison's two grids, as bars.
//
// The domain half again — compareTable.js turns the same entries into rows and columns,
// this turns them into series, and figure.js arranges them. A mark is one model's score on
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

import { suiteFromTask } from "../core/suites.js";
import { createBarPlots } from "./bar.js";
import { seriesColour } from "./palette.js";

// Every task on screen carries the suite the comparison is scoped to — "ts1-choice",
// "ts1-licking_rate" — so the axis shows the part that differs. The tooltip still names the
// task in full, which is where the key rather than the tick label is read.
function taskLabel(taskId) {
  return suiteFromTask(taskId) ? taskId.slice(taskId.indexOf("-") + 1) : taskId;
}

// Grouping and titling both key on it, so a task whose score never named its metric lands
// in one plot rather than in a plot per unnamed metric.
function metricOf(task) {
  return task.metric || "score";
}

/**
 * One series per model per metric: the plots are per metric, and a model spanning two of
 * them is two series that happen to share a name and a colour.
 *
 * @param axisTitle  what the y axis of a metric's panel is called, given the metric.
 * @param valueOf    (entry, taskId) => { mean, sem } | null — what this model has to show
 *                   for that task, or nothing.
 * @param skip       a model id to leave out while keeping its place in the colour order.
 *                   The difference chart's baseline: it has no series of its own, and
 *                   taking it out of the numbering instead would recolour every model each
 *                   time the reader changed it.
 */
function toModelSeries(entries, tasks, { axisTitle, valueOf, skip = null }) {
  const metrics = [...new Set(tasks.map(metricOf))];

  return metrics.flatMap((metric) => {
    const taskIds = tasks
      .filter((task) => metricOf(task) === metric)
      .map((task) => task.taskId);

    return (
      entries
        // Coloured by the model's position, which toCompareEntries has already put in the
        // order the grid's columns use — so a model is the same mark in every plot, in both
        // charts, and the same column throughout.
        .map((entry, index) => ({ entry, colour: seriesColour(index) }))
        .filter(({ entry }) => entry.modelId !== skip)
        .map(({ entry, colour }) => {
          const values = taskIds.map((taskId) => valueOf(entry, taskId));

          return {
            colour,
            label: entry.modelName,
            metric: axisTitle(metric),
            group: metric,
            index: new Map(taskIds.map((taskId, at) => [taskId, at])),
            // Nothing to show is a gap rather than a zero, exactly as the grids leave the
            // cell "—" rather than printing a number they don't have.
            values: {
              mean: values.map((value) => value?.mean ?? null),
              sem: values.map((value) => value?.sem ?? null),
            },
          };
        })
    );
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
 * @returns { element, charts } — as createBarPlots.
 */
function createModelPlots({ entries, tasks }) {
  return createBarPlots({
    ...PLOT,
    entries: toModelSeries(entries, tasks, {
      axisTitle: (metric) => metric,
      valueOf: (entry, taskId) => entry.tasks[taskId] ?? null,
    }),
  });
}

/**
 * The difference grid plotted: how far each model is from the baseline on every task, as
 * bars either side of zero.
 *
 * No whiskers, and deliberately. The spread of a difference is not either model's sem, and
 * the usual √(s₁² + s₂²) would assume the two were measured independently when they were
 * scored on the same recordings — which overstates it. The scores' own spreads are one
 * chart up.
 *
 * One y range across every plot, where the chart above keeps one per metric. A difference is
 * a distance from the baseline rather than a score, so the question a reader brings here is
 * how big it is — and autoscaled apart, a 0.02 gain in one metric would be drawn the same
 * height as a 0.20 gain in another.
 *
 * @param baselineId the model everything is measured against, which gets no series of its
 *                   own: it would be a row of zeros.
 */
function createDiffPlots({ entries, tasks, baselineId }) {
  const baseline = entries.find((entry) => entry.modelId === baselineId);

  return createBarPlots({
    ...PLOT,
    scale: "all",
    entries: baseline
      ? toModelSeries(entries, tasks, {
          axisTitle: (metric) => `Δ ${metric}`,
          skip: baselineId,
          valueOf: (entry, taskId) => {
            const other = entry.tasks[taskId];
            const against = baseline.tasks[taskId];

            // A task only one of the two scored has no difference to state — the same rule
            // toDiffRows applies, and for the same reason: a number in one grid and "—" in
            // the other would read as a gap of exactly that size.
            return other && against
              ? { mean: other.mean - against.mean, sem: null }
              : null;
          },
        })
      : [],
  });
}

export { createDiffPlots, createModelPlots };
