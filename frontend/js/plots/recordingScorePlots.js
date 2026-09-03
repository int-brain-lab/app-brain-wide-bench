// What a task score measured on every recording it was run on, with its spread.
//
// The domain half: this says what a category is — a recording for TS1 and TS2, a brain
// region for TS3 — and figure.js does the arranging.
//
// A store carries its own dimension, so this module never asks which suite it is holding.
// What it does have to know is that the dimensions don't mix: a region is not a recording,
// and an axis holding both would be one axis pretending to be two. So the dimension is the
// group the arrangement keys its axes on.

import { createBarPlots } from "./bar.js";
import { buildHeatmaps } from "./heatmap.js";
import { createScatterPlots } from "./scatter.js";

// Nothing to draw: a metric the store never recorded, which is a series of gaps rather than
// a missing series — the plot is still one of the metrics on offer.
const NO_VALUES = { mean: [], sem: [] };

// How many recordings a plot names, by how many columns it shares the page with: a recording
// id is a uuid, so a label is the eight-character head of one, and three of those is what a
// third of the page holds. The marks are still every recording, and the tooltip carries the
// whole id.
const LABELS = { 1: 10, 2: 5, 3: 3 };
const NARROWEST = LABELS[3];

// Region and metric names are few, short, and the point of their own axis, so they are shown
// whole. The defaults are a labelled position on an unshared axis, for a caller with no
// arrangement to report.
//
// The label sits in the middle of the stride rather than at the start of it, so the first one
// is clear of the y axis: at index 0 it is drawn against the value labels and the two read as
// one smudge.
function recordingTickLabel(key, { group, index = 0, count = 1, columns = 1 }) {
  if (group !== "recording") return key;

  const named = LABELS[columns] ?? NARROWEST;
  const stride = Math.max(1, Math.ceil(count / named));

  return index % stride === Math.floor(stride / 2)
    ? String(key).slice(0, 8)
    : null;
}

/**
 * One score, read in one metric, as a plot series.
 *
 * @param store  from toRecordingStore — the score's breakdown, column-wise.
 * @param metric which of `store.metrics` this series draws.
 * @param style  the presentation: `{ colour, label }`.
 */
function toScoreSeries(store, metric, style) {
  return {
    ...style,
    metric,
    group: store.group,
    index: store.index,
    values: store.metrics[metric] ?? NO_VALUES,
  };
}

/**
 * @param entries the series, from toScoreSeries.
 * @param facet   "metric" for one plot per metric, "score" for one plot per score — see
 *                groupSeries in figure.js.
 * @param layout  "stack", "row", "pair" or "grid" — see LAYOUTS in figure.js. Omit for the
 *                arrangement each facet is usually wanted in.
 * @param size    "regular" or "tall".
 * @param legend  false where the plots are one score measured several ways: the axis names
 *                the metric and the heading names the score.
 * @returns { element, charts } — as createScatterPlots.
 */
function createRecordingPlots({
  entries,
  facet = "metric",
  layout,
  size = "regular",
  legend = facet === "metric" && entries.length > 1,
}) {
  return createScatterPlots({
    entries,
    // A plot per score is a plot per series here: a score contributes one.
    facet: facet === "score" ? "series" : "metric",
    layout,
    size,
    // Recordings have no order of their own, so the strongest series orders the axis.
    order: "value",
    tickLabel: recordingTickLabel,
    legend,
  });
}

/**
 * The same scores as bars: a plot per score, a bar per recording.
 *
 * The other way of reading what createRecordingPlots draws — the same panels, the same axis in
 * the same order, and only the mark different. A bar says how much of the metric a recording
 * got, read against a baseline the axis includes; a point says where it sits. Which of the two
 * answers the question is the reader's to decide, so both are on offer and nothing else about
 * the arrangement moves when they switch.
 *
 * The same arguments as createRecordingPlots, so a caller offering both can hand the reader's
 * choice to whichever of them it is — see renderPlot in comparisons/taskScoreComparison.js.
 *
 * @param entries the series, from toScoreSeries.
 * @param facet   as createRecordingPlots.
 * @param layout  as createRecordingPlots.
 * @param size    as createRecordingPlots.
 * @returns { element, charts } — as createBarPlots.
 */
function createRecordingBars({
  entries,
  facet = "metric",
  layout,
  size = "regular",
}) {
  return createBarPlots({
    entries,
    // A plot per score is a plot per series here: a score contributes one.
    facet: facet === "score" ? "series" : "metric",
    layout,
    size,
    // As createRecordingPlots: recordings have no order of their own, so the strongest series
    // orders the axis and the rest are read against it.
    order: "value",
    tickLabel: recordingTickLabel,
    // A plot per score is titled with it, so a key naming them would say it twice. A plot per
    // metric holds several and needs one — and it has to be the shared key rather than a
    // legend inside each, since packing the bars leaves a dataset no longer one series.
    legend: facet === "metric" && entries.length > 1 ? "shared" : false,
  });
}

/**
 * The same scores as blocks of cells — see buildHeatmaps.
 *
 * @param entries the series, from toScoreSeries.
 * @returns the markup.
 */
function buildRecordingHeatmaps({ entries }) {
  return buildHeatmaps({
    entries,
    tickLabel: recordingTickLabel,
    // Uuids are unreadable at a cell's width; a region name is the point of the row.
    showColumns: (group) => group !== "recording",
  });
}

export {
  buildRecordingHeatmaps,
  createRecordingBars,
  createRecordingPlots,
  toScoreSeries,
};
