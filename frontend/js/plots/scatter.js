// Dots with error bars, over categories.
//
// For many categories, or a scale a bar has no business claiming a baseline on: a dot says
// only where a value sits. Never a line joining them — the categories have no order, so a
// line draws a trend that isn't there.

import { SURFACE, createCategoryChart } from "./chartjs.js";
import { DEFAULT_HEIGHT, arrangePlots, toDatasets } from "./figure.js";

// The series' colour, ringed in the surface colour so two series landing on the same value
// stay two marks rather than one muddled blob.
function pointMark(entry) {
  return {
    borderColor: entry.colour,
    backgroundColor: entry.colour,
    pointStyle: "circle",
    pointBorderColor: SURFACE,
    pointBorderWidth: 2,
    pointRadius: 5,
    pointHoverRadius: 7,
    showLine: false,
    spanGaps: false,
  };
}

/**
 * @param series    the plot's series.
 * @param labels    the axis, as category keys, in the order it shows them.
 * @param axisTitle what the y axis is measured in.
 * @param tickLabel (key) => what the axis shows for a category.
 * @param range     {min, max} the plot spans, shared with every plot of the same metric.
 *                  Omit to let the values frame themselves.
 * @param title     a heading inside the plot. Omit for none.
 * @param height    plot height in px.
 * @param showAxis  false where the axis is repeated below, or unreadable at this width.
 * @returns { element, chart } — `element` is detached until the caller places it, and
 *          `chart` has to be destroyed before it is replaced.
 */
function createScatterPlot({
  series,
  labels,
  axisTitle,
  tickLabel = (key) => key,
  range = null,
  title = null,
  height = DEFAULT_HEIGHT,
  showAxis = true,
}) {
  return createCategoryChart({
    type: "line",
    labels,
    datasets: toDatasets(series, labels, pointMark),
    axisTitle,
    tickLabel,
    // Dots say only where a value sits, so the axis is free to frame the data.
    span: range,
    title,
    height,
    showAxis,
    // The series are named outside the plot — see createBarPlot.
    legend: false,
    caller: "createScatterPlot",
  });
}

/**
 * Several of them, arranged — stacked by default, since a stack can share one axis and a
 * reader comparing across recordings reads down.
 *
 * @param entries the series.
 * @param rest    as arrangePlots in figure.js.
 * @returns { element, charts }.
 */
function createScatterPlots({
  entries,
  facet = "metric",
  layout = facet === "series" ? "grid" : "stack",
  size = "regular",
  order = "value",
  scale = "metric",
  tickLabel = (key) => key,
}) {
  return arrangePlots({
    entries,
    createPlot: createScatterPlot,
    facet,
    layout,
    size,
    order,
    scale,
    tickLabel,
  });
}

export { createScatterPlot, createScatterPlots };
