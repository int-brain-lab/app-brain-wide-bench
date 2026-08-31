// The shape of a task score's breakdown, and the one pass that reads it.
//
// `score.metrics.recordings` is written by the scorers in app/scoring: one entry per
// (label, task, recording), each carrying `{metric: {mean, sem, n}}` where `n` is the seed
// count it was aggregated from. What a *row* of that is depends on the suite, so the
// dimension is read off the data rather than passed in — see `rowMode`.
//
// Everything that has to know which suite it is holding is here. The table below it builds
// rows, the charts build series, and neither asks again.

// ts3 names its metrics `<brain region>/<metric>` — "TH/f1-score", "macro/precision".
const REGION_SEPARATOR = "/";

// ─── SHAPE ───────────────────────────────────────────────────────────────────

// First-seen order across every entry rather than the keys of the first one: the scorers
// emit metrics in ReadoutSpec order, which puts the task's primary metric first, and an
// entry that lost a metric can't hide it from the union.
function metricNames(recordings) {
  const names = [];

  for (const recording of recordings ?? []) {
    for (const name of Object.keys(recording.metrics ?? {})) {
      if (!names.includes(name)) names.push(name);
    }
  }

  return names;
}

function splitMetric(name) {
  const at = name.indexOf(REGION_SEPARATOR);

  return [name.slice(0, at), name.slice(at + 1)];
}

/**
 * Which dimension the rows run down:
 *
 *   "recording"  ts1 and ts2 score each recording separately — a row is a recording, a
 *                column pair is a metric.
 *   "region"     ts3 classifies the whole held-out population at once, so there is no
 *                recording. Its metric names carry the dimension instead: a row is a brain
 *                region and a column pair is the metric suffix.
 *   "metric"     neither — a row per metric, for a score whose metric names follow no
 *                convention.
 */
function rowMode(recordings) {
  if ((recordings ?? []).some((recording) => recording.recording_id))
    return "recording";

  const names = metricNames(recordings);

  return names.length && names.every((name) => name.includes(REGION_SEPARATOR))
    ? "region"
    : "metric";
}

// ─── STORE ───────────────────────────────────────────────────────────────────

// `[category key, metric name, stats]` for every measurement, whichever dimension the score
// has. In the metric layout a category *is* a metric, so each one holds a single cell.
function toCells(recordings, mode) {
  const cells = [];

  for (const recording of recordings) {
    for (const [name, stats] of Object.entries(recording.metrics ?? {})) {
      if (mode === "region") {
        const [region, metric] = splitMetric(name);

        cells.push([region, metric, stats]);
      } else if (mode === "recording") {
        cells.push([recording.recording_id ?? null, name, stats]);
      } else {
        cells.push([name, name, stats]);
      }
    }
  }

  return cells;
}

/**
 * One score's breakdown, column-wise: the categories it was measured over, and a pair of
 * arrays per metric in step with them.
 *
 * @param recordings `score.metrics.recordings` from the API. Omit for an empty store.
 *
 * @returns `{ group, index, metrics, seeds, label }`. `group` is `rowMode`'s, and is what
 *          must not be mixed down one axis. `index` is category key → position, in the order
 *          the scorer emitted them. `metrics` is `{ [name]: { mean, sem } }` and `seeds` the
 *          largest `n` behind each category — all of them `index.size` long, and `null` where
 *          a category lacks the metric. `label` is the score's own, which a category with no
 *          key of its own is named by.
 */
function toRecordingStore(recordings) {
  const entries = recordings ?? [];
  const group = rowMode(entries);
  const cells = toCells(entries, group);

  const index = new Map();
  const metrics = {};

  for (const [key] of cells) {
    if (!index.has(key)) index.set(key, index.size);
  }

  // The largest `n` across a category's metrics: they agree in practice, and the max means a
  // metric that failed on one seed reports the seeds the category actually has.
  const seeds = Array(index.size).fill(null);

  for (const [, name] of cells) {
    metrics[name] ??= {
      mean: Array(index.size).fill(null),
      sem: Array(index.size).fill(null),
    };
  }

  for (const [key, name, stats] of cells) {
    const at = index.get(key);

    metrics[name].mean[at] = stats?.mean ?? null;
    metrics[name].sem[at] = stats?.sem ?? null;

    if (stats?.n != null) seeds[at] = Math.max(seeds[at] ?? 0, stats.n);
  }

  return {
    group,
    index,
    metrics,
    seeds,
    label: entries.find((recording) => recording.label)?.label ?? null,
  };
}

// What a caller renders before the fetch lands: no categories, no metrics, no series.
const EMPTY_STORE = toRecordingStore([]);

export { EMPTY_STORE, toRecordingStore };
