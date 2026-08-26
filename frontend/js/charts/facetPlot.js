// Small multiples with error bars — dots or bars: the shape every chart in the app turns
// out to be, once the domain is taken out of it.
//
// chart.js owns the Chart.js instance and the house defaults; this owns the arrangement —
// which series share a panel, which share an axis, and which share a scale — and a domain
// module (recordingChart.js, compareChart.js) owns only what a point is. It was written
// inside recordingChart.js and lifted out when the model comparison needed the same
// arrangement over tasks rather than recordings.
//
// A series is `{ label, colour, pointStyle, repeat, metric, group, points }`, where a point
// is `{ key, label, mean, sem }`. Two rules the arrangement rests on:
//
//   1. One panel per metric. Two metrics on one axis is two scales pretending to be one —
//      bacc's chance level is 0.5 and r2's is 0 — and a loss shares an axis with a score
//      only if *up* is allowed to mean opposite things. Faceting settles both.
//   2. Panels of the same metric share a y range, and series of the same `group` share an
//      x axis. Small multiples are comparable only if their axes are; and a group is
//      whatever must not be mixed down one axis — recordings and brain regions are
//      different groups, and so are the task sets of two different metrics.
//
// Never a line: the categories on the x axis have no order, so a line joining them draws a
// trend that isn't there. Which of dots or bars is the caller's — a bar's length is the
// value, which is the stronger read where there are few categories and a zero to stand on;
// dots are for many categories, or a scale a bar has no business claiming a baseline on.

import {
  AXIS,
  createChart,
  destroyChart,
  GRID,
  hatch,
  SEM_INK,
  SURFACE,
} from "./chart.js";
import { resolveContainer } from "../tables/table.js";
import { score } from "../core/utils.js";

// A panel holds the series that share both a metric and an axis — see rule 2 above. A TS3
// score measured in something a TS1 score also reports would otherwise land on one panel,
// with regions and recordings down the same axis.
function panelKey(entry) {
  return `${entry.group}|${entry.metric}`;
}

// ─── AXES ───────────────────────────────────────────────────────────────────

/**
 * Every point any series has, in the order the axis should show them.
 *
 * @param order "value" ranks them by the first series, descending — for categories with no
 *              order of their own, where 29 unsorted recordings are a wall and putting the
 *              first selection in order gives the eye a line to read the others against.
 *              "given" keeps the order the points arrive in, for categories that have one
 *              already: task ids are sorted, and reordering them per selection would move
 *              a task around the axis every time a model was ticked.
 *
 * Keys the first series lacks keep their own order and follow, rather than being dropped —
 * a recording only the second score covers is still a result.
 */
function axisKeys(series, order) {
  const [first, ...rest] = series;

  const ordered =
    order === "value"
      ? [...(first ?? [])]
          .sort((a, b) => (b.mean ?? -Infinity) - (a.mean ?? -Infinity))
          .map((point) => point.key)
      : (first ?? []).map((point) => point.key);

  for (const points of rest) {
    for (const point of points) {
      if (!ordered.includes(point.key)) ordered.push(point.key);
    }
  }

  return ordered;
}

// One axis per group, each the union across the series that share it — so a comparison
// holding both a TS1 score and a TS3 one draws 29 recordings on the first and 11 regions on
// the second, rather than 40 of something.
function panelAxes(entries, order) {
  const series = new Map();

  for (const entry of entries) {
    series.set(entry.group, [...(series.get(entry.group) ?? []), entry.points]);
  }

  return new Map(
    [...series].map(([group, points]) => [group, axisKeys(points, order)]),
  );
}

/**
 * The value range each panel spans, across every series that would land in it.
 *
 * Small multiples are only comparable if their axes are: two panels of the same metric,
 * autoscaled apart, draw the same numbers at different heights and invite exactly the wrong
 * reading. A metric no one else uses keeps its own range, which is what autoscaling would
 * have given it anyway.
 */
function panelRanges(entries) {
  const ranges = new Map();

  for (const entry of entries) {
    const values = entry.points
      .filter((point) => point.mean != null)
      .flatMap((point) => [
        point.mean - (point.sem ?? 0),
        point.mean + (point.sem ?? 0),
      ]);

    if (!values.length) continue;

    const key = panelKey(entry);
    const held = ranges.get(key);

    ranges.set(key, {
      min: Math.min(held?.min ?? Infinity, ...values),
      max: Math.max(held?.max ?? -Infinity, ...values),
    });
  }

  return ranges;
}

// ─── SERIES ─────────────────────────────────────────────────────────────────

// A dot: the series' colour, told apart from a repeat of it by its shape, and ringed in the
// surface colour so two series landing on the same value stay two marks rather than one
// muddled blob.
function pointMark(entry) {
  return {
    borderColor: entry.colour,
    backgroundColor: entry.colour,
    pointStyle: entry.pointStyle ?? "circle",
    pointBorderColor: SURFACE,
    pointBorderWidth: 2,
    pointRadius: 5,
    pointHoverRadius: 7,
    showLine: false,
    spanGaps: false,
  };
}

// A bar: filled, hatched where the hues have come round and shape is not available to say
// so, and with its whisker in ink because its own colour is underneath it.
function barMark(entry) {
  return {
    backgroundColor: entry.repeat ? hatch(entry.colour) : entry.colour,
    borderColor: entry.colour,
    borderWidth: 0,
    borderRadius: 2,
    semColor: SEM_INK,
    // What the legend draws its swatch as, since `usePointStyle` is on: a rectangle, so the
    // key looks like the thing it is a key to.
    pointStyle: "rect",
    // The bars of one category sit together with a gap to the next group, so the eye reads
    // "these belong to this task" before it reads any single value.
    categoryPercentage: 0.72,
    barPercentage: 0.92,
  };
}

const MARKS = { point: pointMark, bar: barMark };

/**
 * @param entries the panel's series.
 * @param labels  the axis, computed across *every* series rather than this panel's — see
 *                renderFacetPlots. Panels that don't share an axis can't be read as one
 *                figure, and a stack of them is the figure.
 * @param mark    "point" or "bar".
 * @returns {shortLabels, datasets} for createChart. The chart's `labels` are the point keys
 *          themselves, so two series line up on the same category even where the axis shows
 *          an abbreviation of it.
 */
function toDatasets(entries, labels, mark) {
  // Key → what an axis should show for it, taken from whichever series has the point.
  const shortLabels = new Map(
    entries.flatMap((entry) => entry.points.map((p) => [p.key, p.label])),
  );

  return {
    shortLabels,
    datasets: entries.map((entry) => {
      const byKey = new Map(entry.points.map((point) => [point.key, point]));

      return {
        // No metric in the label: the panel this series is in is the metric, and its axis
        // is titled with it — repeating it on every legend entry says nothing twice.
        label: entry.label,
        // Positioned by index against `labels` rather than by an `x` the category scale
        // would have to match: a point whose x it fails to place lands at the axis origin,
        // which draws a chart that looks plausible and is wrong.
        data: labels.map((key) => byKey.get(key)?.mean ?? null),
        sems: labels.map((key) => byKey.get(key)?.sem ?? null),
        ...(MARKS[mark] ?? pointMark)(entry),
      };
    }),
  };
}

// ─── PANELS ─────────────────────────────────────────────────────────────────

// Two ways to cut the same series into panels:
//
//   metric   one panel per metric, stacked full width. For one result read several ways, or
//            a handful of results where the interesting comparison is between them.
//   series   one panel per series, in a grid. For many of them, where colour has run out:
//            eight hues a reader can tell apart do not exist, so identity moves to the
//            panel title and every mark takes one ink.
//
// Grouped in the order they were first given, so a panel doesn't jump around the page when
// an unrelated one changes.
function toPanels(entries, facet) {
  if (facet === "series") return entries.map((entry) => [entry.label, [entry]]);

  const panels = new Map();

  for (const entry of entries) {
    const key = panelKey(entry);

    panels.set(key, [...(panels.get(key) ?? []), entry]);
  }

  return [...panels.values()].map((members) => [members[0].metric, members]);
}

/**
 * @param container element, or the id of one.
 * @param entries   the panel's series.
 * @param labels    the shared axis.
 * @param metric    what the y axis is measured in.
 * @param title     a heading inside the panel, for a grid where the title is the identity.
 * @param range     {min, max} shared with every panel of the same metric.
 * @param mark      "point" or "bar".
 * @param showAxis  false where the axis is repeated below, or unreadable at this width.
 * @param height    panel height.
 * @param legend    whether this panel names its series.
 * @param caller    name used in error messages.
 */
function renderPanel({
  container,
  entries,
  labels,
  metric,
  title,
  range,
  mark,
  showAxis,
  height,
  legend,
  caller,
}) {
  const { shortLabels, datasets } = toDatasets(entries, labels, mark);

  // A bar's length is the value, so the axis it stands on has to include zero: cropped to
  // the data, a 2% difference between two models is drawn as one bar twice the height of
  // the other. Dots say only where a value sits, so theirs is free to frame the data.
  const span =
    range && mark === "bar"
      ? { min: Math.min(0, range.min), max: Math.max(0, range.max) }
      : range;

  return createChart({
    container,
    type: mark === "bar" ? "bar" : "line",
    data: { labels, datasets },
    legend,
    height,
    tooltip: {
      callbacks: {
        // The whole key, where the axis had room only for the head of it.
        title: (items) => items[0]?.label ?? "",
        label: (item) => {
          const sem = item.dataset.sems?.[item.dataIndex];

          return `${item.dataset.label}: ${score(item.raw)}${sem == null ? "" : ` ± ${score(sem)}`}`;
        },
      },
    },
    options: {
      plugins: title
        ? { title: { display: true, text: title, align: "start", color: AXIS } }
        : {},
      scales: {
        x: {
          type: "category",
          ticks: {
            display: showAxis,
            callback: (_, index) => shortLabels.get(labels[index]) ?? "",
          },
        },
        y: {
          title: { display: true, text: metric, color: AXIS },
          // Bars stand on zero, so zero is drawn as a line rather than as one gridline
          // among several — on a chart of differences it is the boundary between ahead and
          // behind, and a reader shouldn't have to find it by reading the ticks.
          ...(mark === "bar"
            ? {
                grid: {
                  color: (context) => (context.tick?.value === 0 ? AXIS : GRID),
                },
              }
            : {}),
          ...(span ? { suggestedMin: span.min, suggestedMax: span.max } : {}),
        },
      },
    },
    caller,
  });
}

// How the panels are arranged on the page:
//
//   stack  one under another, full width. The default, and the only one where panels can
//          share an axis: a stack of them lines up vertically, so the bottom panel's
//          labels are the whole stack's.
//   row    side by side. For a handful of panels a reader compares across rather than
//          reads down — and each carries its own axis, since nothing is under anything.
//   grid   three across, wrapping. For many panels, where each is its own small figure.
const LAYOUTS = { stack: "column", row: "chart-row", grid: "chart-grid" };

// Panel heights, by layout. `tall` is for a chart the reader has chosen to look at closely
// — several series on one pair of axes, where the whole point is the distance between them,
// and 220px of it is a smudge. A lone panel gets the page's full height whatever the layout
// asked for, because there is nothing beside or below it to share with.
const HEIGHTS = {
  regular: { grid: 200, row: 260, stack: 220, single: 360 },
  tall: { grid: 260, row: 320, stack: 320, single: 480 },
};

function panelHeight(size, { layout, count }) {
  const heights = HEIGHTS[size] ?? HEIGHTS.regular;

  if (layout === "grid") return heights.grid;

  return count > 1 ? heights[layout] : heights.single;
}

/**
 * @param container element, or the id of one. Its contents are replaced.
 * @param entries   the series — see the module header.
 * @param charts    the instances from a previous call, destroyed before these mount.
 * @param facet     "metric" or "series" — which series share a panel, see toPanels.
 * @param layout    "stack", "row" or "grid" — where those panels go, see LAYOUTS. Defaults
 *                  to the arrangement each facet is usually wanted in.
 * @param size      "regular" or "tall" — see HEIGHTS.
 * @param order     how each axis is sorted — see axisKeys.
 * @param mark      "point" or "bar" — what a value is drawn as, see MARKS.
 * @param legend    false where the panels are one result measured several ways: the axis
 *                  names the metric and the heading names the result, so a legend under
 *                  each panel would repeat the same words three times.
 * @param caller    name used in error messages.
 * @returns the Chart instances, one per panel.
 */
function renderFacetPlots({
  container,
  entries,
  charts = [],
  facet = "metric",
  layout = facet === "series" ? "grid" : "stack",
  size = "regular",
  order = "value",
  mark = "point",
  legend = facet === "metric" && entries.length > 1,
  caller = "renderFacetPlots",
}) {
  charts.forEach(destroyChart);

  const panels = toPanels(entries, facet);
  const ranges = panelRanges(entries);
  const axes = panelAxes(entries, order);
  const grid = layout === "grid";

  // The last panel of each group, since in a stack only those carry their axis: a stack of
  // recording panels labels its bottom one, and a region panel below them labels itself
  // rather than borrowing labels that aren't its own.
  const lastOfGroup = new Map(
    panels.map(([, members], index) => [members[0].group, index]),
  );

  const root = resolveContainer(container, caller);

  root.innerHTML = `
    <div class="${LAYOUTS[layout] ?? LAYOUTS.stack}">
      ${panels.map((_, index) => `<div class="chart-facet" data-panel="${index}"></div>`).join("")}
    </div>`;

  const height = panelHeight(size, { layout, count: panels.length });

  return panels.map(([name, members], index) =>
    renderPanel({
      container: root.querySelector(`[data-panel="${index}"]`),
      entries: members,
      labels: axes.get(members[0].group) ?? [],
      metric: members[0].metric,
      // In a grid the panel *is* the series, so it says which one. Stacked and side-by-side
      // panels are one metric each, named by their own y axis, and the series in them are
      // named by the legend or the heading above.
      title: grid ? name : null,
      range: ranges.get(panelKey(members[0])),
      mark,
      // Only a stack can share an axis, and only downwards: the labels under its last
      // panel are read as the whole stack's. Panels side by side have nothing above them to
      // label, so each carries its own — and in a grid the categories are unreadable at a
      // column's width, so none of them do. The tooltip carries the category either way.
      showAxis:
        layout === "row" ||
        (layout === "stack" && lastOfGroup.get(members[0].group) === index),
      height,
      legend,
      caller,
    }),
  );
}

export { panelAxes, panelKey, panelRanges, renderFacetPlots, toPanels };
