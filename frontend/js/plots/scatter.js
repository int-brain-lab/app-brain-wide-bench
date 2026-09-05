// Dots with error bars, over categories.
//
// Never a line joining them: the categories have no order, so a line draws a trend that
// isn't there.

import { SURFACE, createCategoryChart } from "./plot.js";
import { toDatasets } from "./series.js";

function pointMark(series) {
  return {
    borderColor: series.colour,
    backgroundColor: series.colour,
    pointStyle: "circle",
    // Ringed in the surface colour, so two series on one value stay two marks.
    pointBorderColor: SURFACE,
    pointBorderWidth: 2,
    pointRadius: 5,
    pointHoverRadius: 7,
    showLine: false,
    spanGaps: false,
  };
}

/**
 * One plot of points.
 *
 * @param series
 * @param categories      the x axis, as category keys.
 * @param yAxisLabel      what the y axis is measured in.
 * @param xTickLabel      (key, index) => what the axis shows for a category.
 * @param xTickRotation   degrees to turn the x tick labels by.
 * @param yRange          { min, max } the plot spans. Omit to let the values frame
 *                        themselves.
 * @param plotTitle       a heading inside the plot. Omit for none.
 * @param height          plot height in px.
 * @returns { element, chart }.
 */
function createScatterPlot({
  series,
  categories,
  yAxisLabel,
  xTickLabel,
  xTickRotation,
  yRange,
  plotTitle,
  height,
}) {
  return createCategoryChart({
    type: "line",
    categories,
    datasets: toDatasets(series, categories, pointMark),
    yAxisLabel,
    xTickLabel,
    xTickRotation,
    yRange,
    plotTitle,
    height,
  });
}

export { createScatterPlot };
