// Bars with error bars, over categories.
//
// For few enough categories to give each a group of them, where a length read against a
// common baseline answers "by how much" faster than two positions do. That baseline is the
// whole encoding, so the axis has to include zero and zero is drawn as a line.

import { AXIS, GRID, SEM_INK, createCategoryChart } from "./chartjs.js";
import { DEFAULT_HEIGHT, arrangePlots, toDatasets } from "./figure.js";

// Filled, with its whisker in ink because its own colour is underneath it.
function barMark(entry) {
  return {
    backgroundColor: entry.colour,
    borderColor: entry.colour,
    borderWidth: 0,
    borderRadius: 2,
    semColor: SEM_INK,
    // What the legend draws its swatch as, since `usePointStyle` is on: a rectangle, so the
    // key looks like the thing it is a key to.
    pointStyle: "rect",
    // The bars of one category sit together with a gap to the next group, so the eye reads
    // "these belong to this task" before it reads any single value.
    categoryPercentage: 0.72,
    barPercentage: 0.92,
  };
}

// Zero is drawn as a line rather than as one gridline among several — on a plot of
// differences it is the boundary between ahead and behind, and a reader shouldn't have to
// find it by reading the ticks.
const ZERO_LINE = {
  grid: { color: (context) => (context.tick?.value === 0 ? AXIS : GRID) },
};

/**
 * @param range {min, max} the plot spans, widened to include zero — cropped to the data, a
 *              2% difference between two models is drawn as one bar twice the height of the
 *              other.
 * @param rest  as createScatterPlot in scatter.js.
 * @returns { element, chart }.
 */
function createBarPlot({
  series,
  labels,
  axisTitle,
  tickLabel = (key) => key,
  range = null,
  title = null,
  height = DEFAULT_HEIGHT,
  showAxis = true,
  legend = true,
}) {
  return createCategoryChart({
    type: "bar",
    labels,
    datasets: toDatasets(series, labels, barMark),
    axisTitle,
    tickLabel,
    span: range
      ? { min: Math.min(0, range.min), max: Math.max(0, range.max) }
      : null,
    yGrid: ZERO_LINE,
    title,
    height,
    showAxis,
    legend,
    caller: "createBarPlot",
  });
}

/**
 * Several of them, arranged — in a row by default, and tall: bars are for the few categories
 * a reader compares across rather than reads down, and a group of them per category needs
 * the width to breathe. Each carries its own axis, since nothing is under anything.
 *
 * @param entries the series.
 * @param rest    as arrangePlots in figure.js.
 * @returns { element, charts }.
 */
function createBarPlots({
  entries,
  facet = "metric",
  layout = "row",
  size = "tall",
  order = "given",
  scale = "metric",
  tickLabel = (key) => key,
  legend = true,
}) {
  return arrangePlots({
    entries,
    createPlot: createBarPlot,
    facet,
    layout,
    size,
    order,
    scale,
    tickLabel,
    legend,
  });
}

export { createBarPlot, createBarPlots };
