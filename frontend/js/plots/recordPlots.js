// What recordComparison.js draws: one plot per task, a bar per compared record.

import { createBarPlot } from "./bar.js";

/**
 * One task as a plot: a bar per record.
 *
 * @param series        from toTaskSeries.
 * @param categories    the records' keys, in the order the axis holds them.
 * @param categoryLabel (key) => what a tooltip calls that record.
 * @param yRange        { min, max } the plot spans, shared with the tasks it is comparable to.
 * @param height        in px.
 * @returns { element, chart }.
 */
function createTaskPlot({
  series,
  categories,
  categoryLabel,
  yRange,
  height,
}) {
  return createBarPlot({
    series: [series],
    categories,
    yAxisLabel: series.metric,
    xTickLabel: () => null,
    xTickRotation: 0,
    categoryLabel,
    yRange,
    plotTitle: null,
    height,
  });
}

export { createTaskPlot };
