// What a task score measured on every recording it was run on, with its spread.
//
// The domain half of the plot: this says what a point is — a recording for TS1 and TS2, a
// brain region for TS3 — and facetPlot.js does the arranging. There is nothing about
// Chart.js below, and nothing about recordings above.
//
// A TS3 score has no recordings, and toRecordingPoints answers with whichever dimension the
// score actually has, so this module never asks which suite it is holding. What it does
// have to know is that the dimensions don't mix: a region is not a recording, and an axis
// holding both would be one axis pretending to be two. So the dimension is the group the
// engine keys its axes on.

import { resolveContainer } from "../core/dom.js";
import {
  describeRecordingScores,
  toRecordingPoints,
} from "../tables/recordingScoreTable.js";
import { score } from "../core/utils.js";
import { buildHeatmap } from "./heatmap.js";
import {
  panelAxes,
  panelKey,
  panelRanges,
  renderFacetPlots,
  toPanels,
} from "./facetPlot.js";

// What a score's points run down: recordings for TS1 and TS2, brain regions for TS3, and
// bare metric names for a score whose shape follows neither convention. Two scores share an
// axis only if they share this.
function dimensionOf(entry) {
  return describeRecordingScores(entry.recordings).mode;
}

/**
 * The selected scores as plot series.
 *
 * @param entries [{ key, colour, pointStyle, label, metric, recordings }] — one per
 *                selected score.
 */
function toPointEntries(entries) {
  return entries.map((entry) => ({
    ...entry,
    group: dimensionOf(entry),
    points: toRecordingPoints(entry.recordings, entry.metric),
  }));
}

/**
 * @param container element, or the id of one. Its contents are replaced.
 * @param entries   as toPointEntries.
 * @param charts    the instances from a previous call, destroyed before these mount.
 * @param facet     "metric" for one stacked panel per metric, "score" for a grid of one
 *                  panel per score — see toPanels in facetPlot.js.
 * @param size      "regular" or "tall".
 * @param legend    false where the panels are one score measured several ways: the axis
 *                  names the metric and the heading names the score.
 * @returns the Chart instances, one per panel.
 */
function renderRecordingCharts({
  container,
  entries,
  charts = [],
  facet = "metric",
  size = "regular",
  legend = facet === "metric" && entries.length > 1,
}) {
  return renderFacetPlots({
    container,
    entries: toPointEntries(entries),
    charts,
    // A panel per score is a panel per series here: a score contributes one.
    facet: facet === "score" ? "series" : "metric",
    size,
    // Recordings have no order of their own, so the strongest series orders the axis.
    order: "value",
    legend,
    caller: "renderRecordingCharts",
  });
}

// ─── HEATMAP ────────────────────────────────────────────────────────────────

/**
 * The same comparison as a grid of cells: scores down the rows, recordings across.
 *
 * A different question from the plots rather than a prettier answer to theirs. A dot plot
 * says how much; this says where — a column dark across every row is a recording that is
 * hard for all of them, and a pale row is a score that is behind everywhere rather than
 * somewhere.
 *
 * Blocked exactly as the panels are, and for the same two reasons: a cell's colour is a
 * scale, so two metrics can't share one, and a region is not a recording so they can't
 * share an axis.
 *
 * @param container element, or the id of one. Its contents are replaced.
 * @param entries   as toPointEntries.
 */
function renderRecordingHeatmaps({ container, entries }) {
  const series = toPointEntries(entries);
  const blocks = toPanels(series, "metric");
  const axes = panelAxes(series, "value");
  const ranges = panelRanges(series);

  const root = resolveContainer(container);

  root.innerHTML = blocks
    .map(([metric, members]) => {
      const labels = axes.get(members[0].group) ?? [];
      const points = members.map(
        (entry) => new Map(entry.points.map((point) => [point.key, point])),
      );

      // Read off the points rather than the keys: a recording id is a uuid, and the axis
      // shows the head of one — see toRecordingPoints.
      const shortLabels = new Map(
        points.flatMap((byKey) =>
          [...byKey.values()].map((point) => [point.key, point.label]),
        ),
      );

      return buildHeatmap({
        title: metric,
        range: ranges.get(panelKey(members[0])) ?? { min: 0, max: 1 },
        format: (value) => score(value),
        // Uuids are unreadable at a cell's width; a region name is the point of the row.
        labels: members[0].group !== "recording",
        columns: labels.map((key) => ({
          key,
          label: shortLabels.get(key) ?? key,
        })),
        rows: members.map((entry, index) => ({
          label: entry.label,
          cells: labels.map((key) => {
            const point = points[index].get(key);

            return {
              value: point?.mean ?? null,
              title:
                point?.mean == null
                  ? `${key} — not measured`
                  : `${key} · ${score(point.mean)}${point.sem == null ? "" : ` ± ${score(point.sem)}`}`,
            };
          }),
        })),
      });
    })
    .join("");
}

export { renderRecordingCharts, renderRecordingHeatmaps };
