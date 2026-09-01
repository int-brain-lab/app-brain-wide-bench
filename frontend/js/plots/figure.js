// What several plots have to agree on.
//
// A plot on its own is scatter.js, bar.js or heatmap.js. This is everything that decides
// which series belong on the same plot, what order their categories run in, what range they
// share and how they sit on the page — and it is pure: no Chart.js, no canvas, no DOM beyond
// the one element arrangePlots assembles.
//
// A series is `{ label, colour, metric, group, index, values }`, where `index` is category
// key → position and `values` is `{ mean, sem }`, two arrays in step with it. Two rules
// everything below rests on:
//
//   1. One plot per metric. Two metrics on one axis is two scales pretending to be one —
//      bacc's chance level is 0.5 and r2's is 0 — and a loss shares an axis with a score
//      only if *up* is allowed to mean opposite things.
//   2. Plots of the same metric share a y range — or every plot does, where the caller says
//      they are comparable whatever they measure; see `scale`. Series of the same `group`
//      share an x axis. Small multiples are comparable only if their axes are; and a group is
//      whatever must not be mixed down one axis — recordings and brain regions are different
//      groups, and so are the task sets of two different metrics.

// A plot holds the series that share both a metric and an axis — see rule 2. A TS3 score
// measured in something a TS1 score also reports would otherwise land on one plot, with
// regions and recordings down the same axis.
function plotKey(entry) {
  return `${entry.group}|${entry.metric}`;
}

// ─── SERIES ──────────────────────────────────────────────────────────────────

/**
 * Where each of `labels` sits in a series' arrays, or -1 for a category it never had.
 *
 * Positioned by index rather than by an `x` the category scale would have to match: a value
 * whose x it fails to place lands at the axis origin, which draws a plot that looks
 * plausible and is wrong.
 */
function positionsIn(entry, labels) {
  return labels.map((key) => entry.index.get(key) ?? -1);
}

/**
 * The series as Chart.js datasets, aligned to the axis.
 *
 * @param mark (series) => the styling for its marks — see scatter.js and bar.js.
 */
function toDatasets(series, labels, mark) {
  return series.map((entry) => {
    const at = positionsIn(entry, labels);

    return {
      // No metric in the label: the plot this series is in is the metric, and its axis is
      // titled with it — repeating it on every legend entry says nothing twice.
      label: entry.label,
      data: at.map((position) =>
        position < 0 ? null : (entry.values.mean[position] ?? null),
      ),
      sems: at.map((position) =>
        position < 0 ? null : (entry.values.sem[position] ?? null),
      ),
      ...mark(entry),
    };
  });
}

// ─── AXES ────────────────────────────────────────────────────────────────────

/**
 * Every category any series has, in the order the axis should show them.
 *
 * @param order "value" ranks them by the first series, descending — for categories with no
 *              order of their own, where 29 unsorted recordings are a wall and putting the
 *              first selection in order gives the eye a line to read the others against.
 *              "given" keeps the order the categories arrive in, for categories that have
 *              one already: task ids are sorted, and reordering them per selection would
 *              move a task around the axis every time a model was ticked.
 *
 * Keys the first series lacks keep their own order and follow, rather than being dropped —
 * a recording only the second score covers is still a result.
 */
function axisKeys(entries, order) {
  const [first, ...rest] = entries;
  const held = first ? [...first.index] : [];

  const ordered =
    order === "value"
      ? held
          .sort(
            (a, b) =>
              (first.values.mean[b[1]] ?? -Infinity) -
              (first.values.mean[a[1]] ?? -Infinity),
          )
          .map(([key]) => key)
      : held.map(([key]) => key);

  for (const entry of rest) {
    for (const key of entry.index.keys()) {
      if (!ordered.includes(key)) ordered.push(key);
    }
  }

  return ordered;
}

// One axis per group, each the union across the series that share it — so a comparison
// holding both a TS1 score and a TS3 one draws 29 recordings on the first and 11 regions on
// the second, rather than 40 of something.
function sharedAxes(entries, order) {
  const series = new Map();

  for (const entry of entries) {
    series.set(entry.group, [...(series.get(entry.group) ?? []), entry]);
  }

  return new Map(
    [...series].map(([group, members]) => [group, axisKeys(members, order)]),
  );
}

/**
 * The value range each plot spans, across every series that would land in it.
 *
 * Small multiples are only comparable if their axes are: two plots of the same metric,
 * autoscaled apart, draw the same numbers at different heights and invite exactly the wrong
 * reading. A metric no one else uses keeps its own range, which is what autoscaling would
 * have given it anyway.
 */
function sharedRanges(entries) {
  const ranges = new Map();

  for (const entry of entries) {
    const values = entry.values.mean.flatMap((mean, at) =>
      mean == null
        ? []
        : [
            mean - (entry.values.sem[at] ?? 0),
            mean + (entry.values.sem[at] ?? 0),
          ],
    );

    if (!values.length) continue;

    const key = plotKey(entry);
    const held = ranges.get(key);

    ranges.set(key, {
      min: Math.min(held?.min ?? Infinity, ...values),
      max: Math.max(held?.max ?? -Infinity, ...values),
    });
  }

  return ranges;
}

// One range across every plot, keyed as sharedRanges keyed them, for plots that are
// comparable whatever they measure.
function mergeRanges(ranges) {
  const bounds = [...ranges.values()];

  if (!bounds.length) return ranges;

  const merged = {
    min: Math.min(...bounds.map((range) => range.min)),
    max: Math.max(...bounds.map((range) => range.max)),
  };

  return new Map([...ranges.keys()].map((key) => [key, merged]));
}

// ─── ARRANGEMENT ─────────────────────────────────────────────────────────────

/**
 * Which series share a plot. Two ways to cut them:
 *
 *   metric   one plot per metric. For one result read several ways, or a handful of results
 *            where the interesting comparison is between them.
 *   series   one plot per series. For many of them, where colour has run out: identity moves
 *            to the plot's title and every mark takes one ink.
 *
 * Grouped in the order they were first given, so a plot doesn't jump around the page when an
 * unrelated one changes.
 *
 * @returns [[name, series]] — `name` titles the plot where the layout shows a title.
 */
function groupSeries(entries, facet) {
  if (facet === "series") return entries.map((entry) => [entry.label, [entry]]);

  const plots = new Map();

  for (const entry of entries) {
    const key = plotKey(entry);

    plots.set(key, [...(plots.get(key) ?? []), entry]);
  }

  return [...plots.values()].map((members) => [members[0].metric, members]);
}

// Where the plots go:
//
//   stack  one under another, full width. The only one where plots can share an axis: a
//          stack of them lines up vertically, so the bottom one's labels are the stack's.
//   row    side by side. For a handful a reader compares across rather than reads down —
//          and each carries its own axis, since nothing is under anything.
//   pair   two across. For plots a reader wants close but big: half the width is enough for
//          several series on one pair of axes, and two of them fit above the fold.
//   weighted
//          a grid of category-wide tracks, each plot spanning as many as it holds — so one
//          category is the same width in every plot, and a plot of four tasks is four times a
//          plot of one. A line holds CATEGORIES_PER_LINE of them and the rest wrap, so a
//          suite's plots fill a line and the next suite's start the one below.
//   grid   three across, wrapping. For many, where each is its own small figure.
const LAYOUTS = {
  stack: "column",
  row: "chart-row",
  pair: "chart-pair",
  weighted: "chart-weighted",
  grid: "chart-grid",
};

// Plot heights, by layout. `tall` is for one the reader has chosen to look at closely —
// several series on one pair of axes, where the whole point is the distance between them,
// and 220px of it is a smudge. A lone plot gets the page's full height whatever the layout
// asked for, because there is nothing beside or below it to share with.
const HEIGHTS = {
  regular: {
    grid: 200,
    row: 260,
    pair: 260,
    weighted: 260,
    stack: 220,
    single: 360,
  },
  tall: {
    grid: 260,
    row: 320,
    pair: 320,
    weighted: 320,
    stack: 320,
    single: 480,
  },
};

// What one plot stands at when it is built on its own rather than by arrangePlots.
const DEFAULT_HEIGHT = HEIGHTS.regular.stack;

// The full height goes to a lone plot only in the layouts that would also have given it the
// full width. In a fixed column it stays a column's plot however few there are.
const COLUMNED = ["pair", "grid"];

// How many columns each layout puts the plots in, which is what decides how much room one
// plot's axis has. `.chart-row` is auto-fit above a 320px floor, so it is however many plots
// there are, up to the three that fit a page.
const COLUMNS = { stack: 1, pair: 2, grid: 3 };
const ROW_COLUMNS = 3;

function plotColumns(layout, count) {
  return COLUMNS[layout] ?? Math.min(count, ROW_COLUMNS);
}

// What a full line of the weighted arrangement holds, in categories. A constant, and
// deliberately: it is the width one category is drawn at, so it must not move with whoever
// happens to be picked. Tuned to the biggest suite, whose plots then fill the page — a suite
// with fewer takes proportionally less and centres, and one with more wraps.
const CATEGORIES_PER_LINE = 8;

// How many categories each plot holds, in the order the plots are drawn.
function plotSizes(plots, axes) {
  return plots.map(
    ([, members]) => (axes.get(members[0].group) ?? []).length || 1,
  );
}

/**
 * How wide the arrangement is: what the tracks it uses are worth against a full line. A
 * selection covering three tracks of eight takes three eighths of the page and centres, so a
 * category is drawn at the same width whether or not the rest are on screen.
 */
function weightedWidth(used) {
  return `${Math.min(100, (used / CATEGORIES_PER_LINE) * 100).toFixed(2)}%`;
}

function plotHeight(size, { layout, count }) {
  const heights = HEIGHTS[size] ?? HEIGHTS.regular;

  if (COLUMNED.includes(layout)) return heights[layout];

  return count > 1 ? heights[layout] : heights.single;
}

// One key for plots that hold the same series. Built from the series rather than by Chart.js,
// because a legend inside each plot would say the same names two or three times — and taking
// it off all but the first would leave that one's plot area shorter than its neighbours'.
function createSeriesKey(entries) {
  const key = document.createElement("div");

  key.className = "row left gap-md metadata chart-key";

  const named = new Set();

  for (const entry of entries) {
    if (named.has(entry.label)) continue;

    named.add(entry.label);

    const item = document.createElement("span");
    const swatch = document.createElement("span");
    const name = document.createElement("span");

    item.className = "row left gap-sm";
    swatch.className = "chart-swatch";
    swatch.style.background = entry.colour;
    name.textContent = entry.label;

    item.append(swatch, name);
    key.append(item);
  }

  return key;
}

/**
 * Several plots of one kind, arranged.
 *
 * @param entries    the series.
 * @param createPlot (options) => { element, chart } — the kind, from scatter.js or bar.js.
 * @param facet      "metric" or "series" — see groupSeries.
 * @param layout     "stack", "row", "pair" or "grid" — see LAYOUTS.
 * @param size       "regular" or "tall" — see HEIGHTS.
 * @param order      how each axis is sorted — see axisKeys.
 * @param scale      "metric" for a y range shared by the plots of one metric, "all" for one
 *                   range across every plot — for values that are comparable whatever they
 *                   measure, where autoscaling each plot would draw the same distance at
 *                   different heights.
 * @param tickLabel  (key, {group, index, count, columns}) => what the axis shows for a
 *                   category, or null to leave it unlabelled. `count` is how many categories
 *                   the axis holds and `columns` how many the layout puts across the page,
 *                   so a domain that thins its labels knows how much room it has. The keys
 *                   line the series up, so a domain that abbreviates them — a recording
 *                   uuid, a task id carrying its suite — does it here too.
 * @param legend     true for a legend inside every plot, "shared" for one key above them
 *                   all, false for none.
 * @returns { element, charts } — `element` is detached until the caller places it, and the
 *          charts have to be destroyed before it is replaced.
 */
function arrangePlots({
  entries,
  createPlot,
  facet,
  layout,
  size,
  order,
  scale,
  tickLabel,
  legend,
}) {
  const plots = groupSeries(entries, facet);
  const byMetric = sharedRanges(entries);
  const ranges = scale === "all" ? mergeRanges(byMetric) : byMetric;
  const axes = sharedAxes(entries, order);
  const grid = layout === "grid";

  // The last plot of each group, since in a stack only those carry their axis: a stack of
  // recording plots labels its bottom one, and a region plot below them labels itself
  // rather than borrowing labels that aren't its own.
  const lastOfGroup = new Map(
    plots.map(([, members], index) => [members[0].group, index]),
  );

  const arranged = document.createElement("div");

  arranged.className = LAYOUTS[layout] ?? LAYOUTS.stack;

  const height = plotHeight(size, { layout, count: plots.length });
  const columns = plotColumns(layout, plots.length);

  // A grid of category-wide tracks, each plot spanning as many as it holds: the tracks divide
  // the line, so the gaps come out of the grid rather than out of the plots, and a plot that
  // doesn't fit what is left wraps whole.
  const sizes = layout === "weighted" ? plotSizes(plots, axes) : [];

  // What this selection asks of a line. Fewer tracks than a full line means a narrower grid
  // rather than wider tracks — the same categories at the same width, centred in the page.
  // More means the grid is a full line and the overflow wraps.
  const used = Math.min(
    sizes.reduce((total, size) => total + size, 0),
    CATEGORIES_PER_LINE,
  );

  if (layout === "weighted") {
    arranged.style.setProperty("--plot-tracks", String(used));
    arranged.style.maxWidth = weightedWidth(used);
  }

  const charts = plots.map(([name, members], index) => {
    const group = members[0].group;
    const labels = axes.get(group) ?? [];

    const plot = createPlot({
      series: members,
      labels,
      axisTitle: members[0].metric,
      tickLabel: (key, at) =>
        tickLabel(key, { group, index: at, count: labels.length, columns }),
      range: ranges.get(plotKey(members[0])),
      // In a grid the plot *is* the series, so it says which one. Stacked and side-by-side
      // plots are one metric each, named by their own y axis, and the series in them are
      // named by the legend or the heading above.
      title: grid ? name : null,
      height,
      // Only a stack can share an axis, and only downwards: the labels under its last plot
      // are read as the whole stack's. Every other layout puts plots side by side, where
      // nothing sits above anything, so each carries its own — thinned to what its column
      // holds by the domain's tickLabel.
      showAxis: layout !== "stack" || lastOfGroup.get(group) === index,
      legend: legend === true,
    });

    if (layout === "weighted")
      plot.element.style.gridColumn = `span ${sizes[index]}`;

    arranged.appendChild(plot.element);

    return plot.chart;
  });

  if (legend !== "shared") return { element: arranged, charts };

  const element = document.createElement("div");

  element.className = "column gap-sm";
  element.append(createSeriesKey(entries), arranged);

  return { element, charts };
}

export {
  DEFAULT_HEIGHT,
  arrangePlots,
  groupSeries,
  plotKey,
  positionsIn,
  sharedAxes,
  sharedRanges,
  toDatasets,
};
