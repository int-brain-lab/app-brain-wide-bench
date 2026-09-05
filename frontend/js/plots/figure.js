// What several plots have to agree on.
//
// A series is `{ label, colour, metric, index, values }`, where `index` is category key →
// position and `values` is `{ mean, sem }`, two arrays in step with it. It also carries
// `axis` where its producer hands over a flat list for categoriesPerAxis to bucket.
//
// A plot is `{ axis, name, categories, yRangeKey, series }`, built by the domain modules —
// see plots/modelPlots.js and plots/recordingScorePlots.js. Plots sharing a `categories`
// array line up; plots sharing a `yRangeKey` are drawn against one y range.

// ─── SERIES ──────────────────────────────────────────────────────────────────

/**
 * Where each of `categories` sits in a series' arrays.
 *
 * @param series
 * @param categories the axis, as category keys.
 * @returns one position per category, -1 for one the series never had.
 */
function positionsOf(series, categories) {
  return categories.map((key) => series.index.get(key) ?? -1);
}

/**
 * The series as Chart.js datasets, aligned to the axis.
 *
 * @param allSeries
 * @param categories the axis, as category keys.
 * @param mark       (series) => the styling for its marks — see bar.js and scatter.js.
 * @returns one dataset per series.
 */
function toDatasets(allSeries, categories, mark) {
  return allSeries.map((series) => {
    const at = positionsOf(series, categories);

    return {
      label: series.label,
      data: at.map((position) =>
        position < 0 ? null : (series.values.mean[position] ?? null),
      ),
      sems: at.map((position) =>
        position < 0 ? null : (series.values.sem[position] ?? null),
      ),
      ...mark(series),
    };
  });
}

// ─── CATEGORIES ──────────────────────────────────────────────────────────────

/**
 * Every category any series has, in the order the axis should show them.
 *
 * @param allSeries the series sharing one axis.
 * @param order     "byValue" ranks by the first series, descending, for categories with no
 *                  order of their own. "asGiven" keeps the order they arrive in.
 * @returns the category keys.
 */
function categoriesIn(allSeries, order) {
  const [first, ...rest] = allSeries;
  const held = first ? [...first.index] : [];

  const ordered =
    order === "byValue"
      ? held
          .sort(
            (a, b) =>
              (first.values.mean[b[1]] ?? -Infinity) -
              (first.values.mean[a[1]] ?? -Infinity),
          )
          .map(([key]) => key)
      : held.map(([key]) => key);

  for (const series of rest) {
    for (const key of series.index.keys()) {
      if (!ordered.includes(key)) ordered.push(key);
    }
  }

  return ordered;
}

/**
 * The categories of each axis, for a caller holding series from more than one.
 *
 * @param allSeries each carrying an `axis`.
 * @param order     as categoriesIn.
 * @returns Map of axis => category keys, each the union across the series on it.
 */
function categoriesPerAxis(allSeries, order) {
  const byAxis = new Map();

  for (const series of allSeries) {
    byAxis.set(series.axis, [...(byAxis.get(series.axis) ?? []), series]);
  }

  return new Map(
    [...byAxis].map(([axis, members]) => [axis, categoriesIn(members, order)]),
  );
}

// ─── RANGES ──────────────────────────────────────────────────────────────────

/**
 * The plots with a `range` on each: plots sharing a `yRangeKey` get one span.
 *
 * @param plots
 * @returns the same plots, each with `yRange` as `{ min, max }` or null. Spans mean ± sem,
 *          so a whisker is never clipped.
 */
function withRanges(plots) {
  const spans = new Map();

  for (const plot of plots) {
    for (const series of plot.series) {
      const values = series.values.mean.flatMap((mean, at) =>
        mean == null
          ? []
          : [
              mean - (series.values.sem[at] ?? 0),
              mean + (series.values.sem[at] ?? 0),
            ],
      );

      if (!values.length) continue;

      const held = spans.get(plot.yRangeKey);

      spans.set(plot.yRangeKey, {
        min: Math.min(held?.min ?? Infinity, ...values),
        max: Math.max(held?.max ?? -Infinity, ...values),
      });
    }
  }

  return plots.map((plot) => ({
    ...plot,
    yRange: spans.get(plot.yRangeKey) ?? null,
  }));
}

// ─── ARRANGEMENTS ────────────────────────────────────────────────────────────
//
// Spread one into an arrangement rather than naming these four by hand. `className` and
// `columns` are one fact: .chart-grid is `repeat(3, …)`.
//
//   STACK     one under another, full width. The only one whose plots may share an axis.
//   PAIR      two across.
//   GRID      three across, wrapping.
//   WEIGHTED  a grid of tracks, each plot spanning as many as it has categories. Its column
//             count is its own plots', so it alone leaves `columns` null.

const STACK = {
  className: "column",
  columns: 1,
  sharesAxis: true,
  weighted: false,
};

const PAIR = {
  className: "chart-pair",
  columns: 2,
  sharesAxis: false,
  weighted: false,
};

const GRID = {
  className: "chart-grid",
  columns: 3,
  sharesAxis: false,
  weighted: false,
};

const WEIGHTED = {
  className: "chart-weighted",
  columns: null,
  sharesAxis: false,
  weighted: true,
};

const MAX_COLUMNS = 3;

// The width one category is drawn at, as a share of a line. A constant: it must not move
// with whoever happens to be picked.
const TRACKS_PER_LINE = 6;

function trackSpans(plots) {
  return plots.map((plot) => plot.categories.length || 1);
}

function gridWidth(tracks) {
  return `${Math.min(100, (tracks / TRACKS_PER_LINE) * 100).toFixed(2)}%`;
}

// ─── PLOTS ───────────────────────────────────────────────────────────────────

/**
 * Several plots of one kind, arranged.
 *
 * @param plots       from withRanges — `{ axis, name, categories, yRange, series }` each.
 * @param createPlot  (options) => { element, chart } — the kind, from bar.js or scatter.js.
 * @param className   the container's class, from STACK / PAIR / GRID / WEIGHTED.
 * @param columns     how many plots that class puts across the page. Null for WEIGHTED.
 * @param sharesAxis  whether a plot may borrow the x tick labels of the one below it.
 * @param weighted    whether plots span category-wide tracks.
 * @param height      what every plot is drawn at, in px.
 * @param xTickLabel  (key, {axis, index, count, columns}) => what the axis shows, or null to
 *                    leave it unlabelled.
 * @returns { element, charts }. `element` is detached until the caller places it, and the
 *          charts have to be destroyed before it is replaced.
 */
function arrangePlots({
  plots,
  createPlot,
  className,
  columns,
  sharesAxis,
  weighted,
  height,
  xTickLabel,
}) {
  const arranged = document.createElement("div");

  arranged.className = className;

  const across = columns ?? Math.min(plots.length, MAX_COLUMNS);
  const spans = weighted ? trackSpans(plots) : [];

  const tracks = Math.min(
    spans.reduce((total, span) => total + span, 0),
    TRACKS_PER_LINE,
  );

  if (weighted) {
    arranged.style.setProperty("--plot-tracks", String(tracks));
    arranged.style.maxWidth = gridWidth(tracks);
  }

  // In a stack the tick labels under the last plot of an axis are read as the whole
  // stack's.
  const lastOfAxis = new Map(plots.map((plot, index) => [plot.axis, index]));

  const charts = plots.map((plot, index) => {
    const built = createPlot({
      series: plot.series,
      categories: plot.categories,
      yAxisLabel: plot.series[0]?.metric,
      xTickLabel: (key, at) =>
        xTickLabel(key, {
          axis: plot.axis,
          index: at,
          count: plot.categories.length,
          columns: across,
        }),
      yRange: plot.yRange,
      plotTitle: plot.name ?? null,
      height,
      showXTickLabels: !sharesAxis || lastOfAxis.get(plot.axis) === index,
    });

    // How a host that makes its plots clickable knows which was pressed — see
    // handlePlotClick in comparisons/recordComparison.js.
    built.element.dataset.axis = plot.axis;

    if (weighted) built.element.style.gridColumn = `span ${spans[index]}`;

    arranged.appendChild(built.element);

    return built.chart;
  });

  return { element: arranged, charts };
}

export {
  GRID,
  PAIR,
  STACK,
  TRACKS_PER_LINE,
  WEIGHTED,
  arrangePlots,
  categoriesIn,
  categoriesPerAxis,
  positionsOf,
  toDatasets,
  withRanges,
};
