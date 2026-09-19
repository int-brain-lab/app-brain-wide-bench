// What taskScoreComparison.js draws: one plot per score over its categories — a recording for
// TS1 and TS2, a brain region for TS3 — and one plot of means per task type. This says what a
// category is; the marks are bar.js.

import { REGION_TASK_TYPE } from "../utils/recordingScoreUtils.js";
import { createBarPlot } from "./bar.js";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

// Every metric here runs 0 to 1, so every plot is drawn against the same span and can be
// read against any other.
const SCORE_RANGE = { min: 0, max: 1 };

// A category plot holds tens of bars a few px wide, where the mean plot beside it holds one
// per score: finer than the house whisker, which would otherwise be wider than the bar.
const CATEGORY_SEM = { width: 1, cap: 2 };

// ─── PLOTS ───────────────────────────────────────────────────────────────────

// What the axis holds, named once under it rather than tick by tick: a recording id is a
// uuid, and a plot three across has no room to name forty of them.
function categoryLabelOf(taskType) {
  return taskType === REGION_TASK_TYPE ? "Regions" : "Recordings";
}

/**
 * One score's categories as a plot.
 *
 * @param series     from toScoreSeries.
 * @param categories the axis, shared by every plot measured the same way.
 * @param height     in px.
 * @returns { element, chart }.
 */
function createCategoryPlot({ series, categories, height }) {
  return createBarPlot({
    series: [series],
    categories,
    xAxisLabel: categoryLabelOf(series.taskType),

    // The axis says what its categories are; naming each one says nothing a reader can use.
    xTickLabel: () => null,
    xTickRotation: 0,

    yRange: SCORE_RANGE,
    sem: CATEGORY_SEM,

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

    // Null rather than blank, which takes the tick marks with the labels: a bar is one
    // score, named by the chips above, so a mark under it marks nothing.
    xTickLabel: () => null,
    xTickRotation: 0,
    categoryLabel,
    yRange: SCORE_RANGE,
    plotTitle: null,
    height,
  });
}

export { SCORE_RANGE, createCategoryPlot, createMeanPlot };
