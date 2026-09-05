// Bars with error bars, over categories.

import { AXIS, GRID_INK, SEM_INK, createCategoryChart } from "./plot.js";
import { toDatasets } from "./series.js";

// A cap in px, so two bars on a wide plot are two bars rather than two blocks.
const MAX_BAR_WIDTH = 40;

// `colours` where a plot's bars are its categories rather than its series — one entry per
// category, which is what Chart.js takes.
function barMark(series) {
  return {
    backgroundColor: series.colours ?? series.colour,
    borderColor: series.colours ?? series.colour,
    borderWidth: 0,
    borderRadius: 2,
    semColor: SEM_INK,
    // Bar width is the product of the two, so one knob: a narrow gap, no more.
    categoryPercentage: 0.9,
    barPercentage: 1,
    maxBarThickness: MAX_BAR_WIDTH,
  };
}

// Zero is the boundary a length is read against, so it is a line rather than one gridline
// among several.
const ZERO_LINE = {
  grid: { color: (context) => (context.tick?.value === 0 ? AXIS : GRID_INK) },
};

/**
 * One plot of bars.
 *
 * @param series
 * @param categories      the x axis, as category keys.
 * @param yAxisLabel      what the y axis is measured in.
 * @param xTickLabel      (key, index) => what the axis shows for a category.
 * @param categoryLabel   (key) => what a tooltip calls it. Omit to show the key.
 * @param xTickRotation   degrees to turn the x tick labels by.
 * @param yRange          { min, max } the plot spans, widened to include zero.
 * @param plotTitle       a heading inside the plot. Omit for none.
 * @param height          plot height in px.
 * @returns { element, chart }.
 */
function createBarPlot({
  series,
  categories,
  yAxisLabel,
  xTickLabel,
  categoryLabel,
  xTickRotation,
  yRange,
  plotTitle,
  height,
}) {

  return createCategoryChart({
    type: "bar",
    categories,
    datasets: toDatasets(series, categories, barMark),
    yAxisLabel,
    xTickLabel,
    categoryLabel,
    xTickRotation,
    yRange: yRange
      ? { min: Math.min(0, yRange.min), max: Math.max(0, yRange.max) }
      : null,
    yGrid: ZERO_LINE,
    plotTitle,
    height,
  });
}

export { createBarPlot };
