// What a task score measured on every recording it was run on, with its spread.
//
// This says what a category is — a recording for TS1 and TS2, a brain region for TS3 — and
// figure.js does the arranging. The means over those recordings are here too.

import { mean, sem } from "../core/utils.js";
import { createBarPlot } from "./bar.js";
import {
  STACK,
  arrangePlots,
  categoriesPerAxis,
  withRanges,
} from "./figure.js";
import { buildHeatmaps } from "./heatmap.js";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

// A metric the store never recorded: a series of gaps rather than a missing series.
const NO_VALUES = { mean: [], sem: [] };

// How many recordings a plot names, by how many columns it shares the page with. A recording
// id is a uuid, so a label is the eight-character head of one.
const LABELS = { 1: 10, 2: 5, 3: 3 };
const NARROWEST = LABELS[3];

// The one category a plot of means has. Never shown — createScoreMeans labels it.
const MEAN_CATEGORY = "mean";

/**
 * What a recording axis shows for a category.
 *
 * The label sits in the middle of its stride, so the first is clear of the y axis.
 *
 * @param key
 * @param axis    the series' own — region and metric names are shown whole.
 * @param index   the category's position.
 * @param count   how many categories the axis holds.
 * @param columns how many plots the page holds across.
 * @returns the label, or null to leave the tick unnamed.
 */
function recordingTickLabel(key, { axis, index, count, columns }) {
  if (axis !== "recording") return key;

  const named = LABELS[columns] ?? NARROWEST;
  const stride = Math.max(1, Math.ceil(count / named));

  return index % stride === Math.floor(stride / 2)
    ? String(key).slice(0, 8)
    : null;
}

// ─── SERIES ──────────────────────────────────────────────────────────────────

/**
 * One score, read in one metric, as a plot series.
 *
 * @param store    from toRecordingStore — the score's breakdown, column-wise.
 * @param metric   which of `store.metrics` this series draws.
 * @param taskType what the score's numbers mean — see taskTypeOf.
 * @param colour
 * @param label
 * @returns the series.
 */
function toScoreSeries({ store, metric, taskType, colour, label }) {
  return {
    colour,
    label,
    metric,
    taskType,
    axis: store.group,
    index: store.index,
    values: store.metrics[metric] ?? NO_VALUES,
  };
}

/**
 * One score's mean in one metric, as a plot series: one category, so one bar.
 *
 * @param store    from toRecordingStore.
 * @param metric   which of `store.metrics` is averaged.
 * @param taskType as toScoreSeries.
 * @param colour
 * @param label
 * @returns the series.
 */
function toMeanSeries({ store, metric, taskType, colour, label }) {
  const values = (store.metrics[metric]?.mean ?? []).filter(
    (value) => value != null,
  );

  return {
    colour,
    label,
    metric,
    taskType,
    index: new Map([[MEAN_CATEGORY, 0]]),
    values: {
      mean: [mean(values)],
      sem: [sem(values)],
    },
  };
}

// ─── PLOTS ───────────────────────────────────────────────────────────────────

// Scores measured the same way share a y range; a behavioural readout and a neural
// reconstruction reported in one metric do not.
function yRangeKeyOf(series) {
  return `${series.taskType}|${series.metric}`;
}

/**
 * A plot per score, its recordings across.
 *
 * @param allSeries  from toScoreSeries.
 * @param createPlot createBarPlot or createScatterPlot.
 * @param layout     as arrangePlots — the caller's mounting decides it.
 * @returns { element, charts } — as arrangePlots.
 */
function createScoresByRecording({ allSeries, createPlot, ...layout }) {
  // One list per axis, handed to every plot on it: a score missing four recordings draws
  // gaps rather than a shorter axis of its own.
  const categories = categoriesPerAxis(allSeries, "byValue");

  const plots = withRanges(
    allSeries.map((series) => ({
      axis: series.axis,
      name: series.label,
      categories: categories.get(series.axis) ?? [],
      yRangeKey: yRangeKeyOf(series),
      series: [series],
    })),
  );

  return arrangePlots({
    ...layout,
    plots,
    createPlot,
    xTickLabel: recordingTickLabel,
  });
}

/**
 * One plot of means: a bar per score, with the spread of each.
 *
 * @param allSeries from toMeanSeries, all sharing one category.
 * @param label     what that category is called.
 * @param height    in px, from the caller's own arrangement.
 * @returns { element, charts } — as arrangePlots.
 */
function createScoreMeans({ allSeries, label, height }) {
  const plots = withRanges([
    {
      axis: MEAN_CATEGORY,
      name: null,
      categories: [MEAN_CATEGORY],
      yRangeKey: MEAN_CATEGORY,
      series: allSeries,
    },
  ]);

  return arrangePlots({
    ...STACK,
    height,
    plots,
    createPlot: createBarPlot,
    xTickLabel: () => label,
  });
}

/**
 * The same scores as blocks of cells, one block per way of measuring.
 *
 * @param allSeries from toScoreSeries.
 * @returns the markup.
 */
function buildScoreHeatmaps({ allSeries }) {
  const categories = categoriesPerAxis(allSeries, "byValue");
  const blocks = new Map();

  for (const series of allSeries) {
    const key = yRangeKeyOf(series);

    blocks.set(key, [...(blocks.get(key) ?? []), series]);
  }

  const plots = withRanges(
    [...blocks].map(([key, members]) => ({
      axis: members[0].axis,
      name: members[0].metric,
      categories: categories.get(members[0].axis) ?? [],
      yRangeKey: key,
      series: members,
    })),
  );

  return buildHeatmaps({
    plots,
    xTickLabel: recordingTickLabel,
    // Uuids are unreadable at a cell's width; a region name is the point of the row.
    showHeader: (axis) => axis !== "recording",
  });
}

export {
  buildScoreHeatmaps,
  createScoreMeans,
  createScoresByRecording,
  toMeanSeries,
  toScoreSeries,
};
