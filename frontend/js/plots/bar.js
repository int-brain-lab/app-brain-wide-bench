// Bars with error bars, over categories.

import { AXIS, GRID_INK, SEM_INK, createCategoryChart } from "./chartjs.js";
import { toDatasets } from "./figure.js";

function barMark(series) {
  return {
    backgroundColor: series.colour,
    borderColor: series.colour,
    borderWidth: 0,
    borderRadius: 2,
    semColor: SEM_INK,
    categoryPercentage: 0.72,
    barPercentage: 0.92,
  };
}

/**
 * The bars of a category packed to the left of their group, the empty slots falling at the
 * end.
 *
 * Chart.js divides a category by the number of datasets whether or not each has a value
 * there, so packing is done by moving values between them. A dataset is therefore no longer
 * one series: `barNames` says whose each bar is, and nothing may read a dataset's own
 * `label` or colour.
 *
 * @param datasets from toDatasets.
 * @returns the same datasets, values packed.
 */
function packLeft(datasets) {
  const categories = datasets[0]?.data.length ?? 0;

  const packed = datasets.map((dataset) => ({
    ...dataset,
    data: [],
    sems: [],
    backgroundColor: [],
    borderColor: [],
    barNames: [],
  }));

  for (let at = 0; at < categories; at += 1) {
    const present = datasets.filter((dataset) => dataset.data[at] != null);

    packed.forEach((target, slot) => {
      const source = present[slot];

      target.data.push(source ? source.data[at] : null);
      target.sems.push(source ? source.sems[at] : null);
      target.backgroundColor.push(source ? source.backgroundColor : "#0000");
      target.borderColor.push(source ? source.borderColor : "#0000");
      target.barNames.push(source ? source.label : "");
    });
  }

  return packed;
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
 * @param yRange          { min, max } the plot spans, widened to include zero.
 * @param plotTitle       a heading inside the plot. Omit for none.
 * @param height          plot height in px.
 * @param showXTickLabels false where the labels are repeated below, or unreadable here.
 * @returns { element, chart }.
 */
function createBarPlot({
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
    type: "bar",
    categories,
    datasets: packLeft(toDatasets(series, categories, barMark)),
    yAxisLabel,
    xTickLabel,
    yRange: yRange
      ? { min: Math.min(0, yRange.min), max: Math.max(0, yRange.max) }
      : null,
    yGrid: ZERO_LINE,
    plotTitle,
    height,
    showXTickLabels,
  });
}

export { createBarPlot };
