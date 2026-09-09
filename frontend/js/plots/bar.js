// Bars with error bars, over categories.

import { AXIS, GRID_INK, SEM_INK, createCategoryChart } from "./plot.js";
import { toDatasets } from "./series.js";

// A cap in px, so two bars on a wide plot are two bars rather than two blocks.
const MAX_BAR_WIDTH = 40;

// A bar is drawn the way a badge is: its colour as a wash, with the full colour along the
// edge. Hex only — anything else is handed to Chart.js as it came.
const HEX = /^#[0-9a-f]{6}$/i;

const FILL_ALPHA = "33";

function toFill(ink) {
  if (Array.isArray(ink)) return ink.map((one) => toFill(one));

  return HEX.test(ink ?? "") ? `${ink}${FILL_ALPHA}` : ink;
}

// `colours` where a plot's bars are its categories rather than its series — one entry per
// category, which is what Chart.js takes.
function barMark(series) {
  const ink = series.colours ?? series.colour;

  return {
    backgroundColor: toFill(ink),
    borderColor: ink,
    borderWidth: 1,
    // Chart.js skips the edge a bar grows from; a badge is outlined all the way round.
    borderSkipped: false,
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
 * @param yAxisLabel      what the y axis is measured in. Omit for an unlabelled axis.
 * @param xAxisLabel      what the categories are, named once under them. Omit for an
 *                  unlabelled axis.
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
  xAxisLabel,
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
    xAxisLabel,
    xTickLabel,
    categoryLabel,
    xTickRotation,
    yRange: yRange ? { min: Math.min(0, yRange.min), max: Math.max(0, yRange.max) } : null,
    yGrid: ZERO_LINE,
    plotTitle,
    height,
  });
}

export { createBarPlot };
