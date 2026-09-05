// What taskScoreComparison.js draws: one plot per score over its categories — a recording for
// TS1 and TS2, a brain region for TS3 — one plot of means per task type, and the same numbers
// as heatmap blocks. This says what a category is; the marks are bar.js and scatter.js.

import { REGION_TASK_TYPE } from "../utils/recordingScoreUtils.js";
import { createBarPlot } from "./bar.js";
import { buildHeatmaps } from "./heatmap.js";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

// Every metric here runs 0 to 1, so every plot is drawn against the same span and can be
// read against any other.
const SCORE_RANGE = { min: 0, max: 1 };

// A region name reads across; the head of a uuid does not.
const REGION_ROTATION = 0;
const RECORDING_ROTATION = 45;

// How many categories an axis names, by how many plots share the width of the page.
const NAMED_TICKS = { 1: 10, 2: 6, 3: 4 };
const NARROWEST = 4;

/**
 * What a category is named on the axis.
 *
 * @param key
 * @param taskType the plot's own — region names are shown whole, being few and short.
 * @param index    the category's position.
 * @param count    how many categories the axis holds.
 * @param columns  how many plots the page holds across.
 * @returns the label, or null to leave the tick unnamed. A recording id is a uuid, so a named
 *          one is the eight-character head of it, sat in the middle of its stride so the
 *          first is clear of the y axis.
 */
function categoryTickLabel(key, { taskType, index, count, columns }) {
  if (taskType === REGION_TASK_TYPE) return key;

  const named = NAMED_TICKS[columns] ?? NARROWEST;
  const stride = Math.max(1, Math.ceil(count / named));

  return index % stride === Math.floor(stride / 2)
    ? String(key).slice(0, 8)
    : null;
}

// ─── PLOTS ───────────────────────────────────────────────────────────────────

// One block per way of measuring: a behavioural readout and a neural reconstruction reported
// in one metric are not one reading.
function blockKeyOf(series) {
  return `${series.taskType}|${series.metric}`;
}

/**
 * One score's categories as a plot.
 *
 * @param series     from toScoreSeries.
 * @param categories the axis, shared by every plot measured the same way.
 * @param createPlot createBarPlot or createScatterPlot.
 * @param columns    how many plots the grid puts across, for thinning the tick labels.
 * @param height     in px.
 * @returns { element, chart }.
 */
function createCategoryPlot({
  series,
  categories,
  createPlot,
  columns,
  height,
}) {
  return createPlot({
    series: [series],
    categories,
    yAxisLabel: series.metric,
    xTickLabel: (key, index) =>
      categoryTickLabel(key, {
        taskType: series.taskType,
        index,
        count: categories.length,
        columns,
      }),
    xTickRotation:
      series.taskType === REGION_TASK_TYPE
        ? REGION_ROTATION
        : RECORDING_ROTATION,
    yRange: SCORE_RANGE,
    plotTitle: null,
    height,
  });
}

/**
 * One plot of means: a bar per score, with the spread of each.
 *
 * @param series        from toMeanSeries.
 * @param categories    the scores' keys, in the order the axis holds them.
 * @param categoryLabel (key) => what a tooltip calls that score.
 * @param height        in px.
 * @returns { element, chart }.
 */
function createMeanPlot({ series, categories, categoryLabel, height }) {
  return createBarPlot({
    series: [series],
    categories,
    yAxisLabel: series.metric,
    xTickLabel: () => null,
    xTickRotation: REGION_ROTATION,
    categoryLabel,
    yRange: SCORE_RANGE,
    plotTitle: null,
    height,
  });
}

/**
 * The same scores as blocks of cells, one block per way of measuring.
 *
 * @param allSeries     one per score — see toScoreSeries.
 * @param categoriesFor (taskType) => the categories every block of it shows.
 * @returns the markup.
 */
function buildScoreHeatmaps({ allSeries, categoriesFor }) {
  const blocks = new Map();

  for (const series of allSeries) {
    const key = blockKeyOf(series);

    blocks.set(key, [...(blocks.get(key) ?? []), series]);
  }

  const plots = [...blocks].map(([key, members]) => ({
    id: key,
    taskType: members[0].taskType,
    name: members[0].metric,
    categories: categoriesFor(members[0].taskType),
    yRange: SCORE_RANGE,
    series: members,
  }));

  return buildHeatmaps({
    plots,
    xTickLabel: categoryTickLabel,
    // Uuids are unreadable at a cell's width; a region name is the point of the row.
    showHeader: (taskType) => taskType === REGION_TASK_TYPE,
  });
}

export { buildScoreHeatmaps, createCategoryPlot, createMeanPlot };
