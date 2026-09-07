// The series shape, and what reads it.
//
// A series is `{ label, colour, metric, index, values }`, where `index` is category key →
// position and `values` is `{ mean, sem }`, two arrays in step with it. Each carries its own
// categories, so drawing several on one axis means aligning them — positionsOf and toDatasets
// below.
//
// The domain modules build them: plots/recordPlots.js and plots/taskScorePlots.js.

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
 * @param mark       (series) => the styling for its marks — see bar.js.
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

// ─── RANGES ──────────────────────────────────────────────────────────────────

/**
 * The plots with a y range on each: those sharing a `yRangeKey` get one span.
 *
 * @param plots `{ yRangeKey, series }` each; anything else they carry rides along.
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


export {
  positionsOf,
  toDatasets,
  withRanges,
};
