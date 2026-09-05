// Dots with error bars, over categories.
//
// Never a line joining them: the categories have no order, so a line draws a trend that
// isn't there.

import { SURFACE, createCategoryChart } from "./chartjs.js";
import { toDatasets } from "./figure.js";

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
 * @param yRange          { min, max } the plot spans. Omit to let the values frame
 *                        themselves.
 * @param plotTitle       a heading inside the plot. Omit for none.
 * @param height          plot height in px.
 * @param showXTickLabels false where the labels are repeated below, or unreadable here.
 * @returns { element, chart }.
 */
function createScatterPlot({
  series,
  categories,
  yAxisLabel,
  xTickLabel,
  yRange,
  plotTitle,
  height,
  showXTickLabels,
}) {
  return createCategoryChart({
    type: "line",
    categories,
    datasets: toDatasets(series, categories, pointMark),
    yAxisLabel,
    xTickLabel,
    yRange,
    plotTitle,
    height,
    showXTickLabels,
  });
}

export { createScatterPlot };
