// What recordComparison.js draws: one plot per task, a bar per compared record.

import { createBarPlot } from "./bar.js";
import { buildMetricBadge, buildTaskBadge } from "../components/badges.js";
import { suiteFromTask, taskLabel } from "../core/suites.js";

/**
 * One task as a plot: a bar per record.
 *
 * @param series        from toTaskSeries.
 * @param categories    the records' keys, in the order the axis holds them.
 * @param categoryLabel (key) => what a tooltip calls that record.
 * @param yRange        { min, max } the plot spans, shared with the tasks it is comparable to.
 * @param task          the task id, which names the card over the plot.
 * @param height        in px.
 * @returns { element, chart }.
 */
function createTaskPlot({
  series,
  categories,
  categoryLabel,
  yRange,
  task,
  height,
}) {
  const plot = createBarPlot({
    series: [series],
    categories,

    // Null rather than blank, which takes the tick marks with the labels: a bar is one
    // record, named by the chips above, so a mark under it marks nothing.
    xTickLabel: () => null,
    xTickRotation: 0,
    categoryLabel,
    yRange,
    plotTitle: null,
    height,
  });

  const element = document.createElement("div");

  element.className = "card column gap-lg";
  element.innerHTML = `
    <div class="row gap-sm">
      <span>${buildMetricBadge(series.metric)}</span>
      <span>${buildTaskBadge(taskLabel(task), suiteFromTask(task), "sm")}</span>
    </div>
  `;

  // The node, not its markup: the chart is bound to the canvas inside it, and a copy of the
  // markup is a blank canvas.
  element.appendChild(plot.element);

  return { element, chart: plot.chart };
}

export { createTaskPlot };
