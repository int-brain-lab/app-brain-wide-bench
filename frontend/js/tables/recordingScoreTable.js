// The breakdown behind one task score: every unit it was averaged over, and every metric
// measured on each. Reached by clicking a task name in the task-scores table.
//
// Rows, columns and controls only — the table plumbing is in table.js.
//
// The data is `TaskScore.metrics.recordings`, written by the scorers in app/scoring: one
// entry per (label, task, recording), each carrying `{metric: {mean, sem, n}}` where `n` is
// the seed count that entry was aggregated from.
//
// What a row *is* depends on the suite, so the row dimension is chosen from the data rather
// than passed in — see `rowMode`.

import { escapeHtml } from "../core/utils.js";
import { createFilterableTable, matchIncludes } from "./table.js";
import {
  metricsBadgeFormatter,
  numericSorter,
  scoreSemFormatter,
} from "./formatters.js";

// ts3 names its metrics `<brain region>/<metric>` — "TH/f1-score", "macro/precision".
const REGION_SEPARATOR = "/";


// ─── SHAPE ──────────────────────────────────────────────────────────────────

// First-seen order across every entry rather than the keys of the first one: the scorers
// emit metrics in ReadoutSpec order, which puts the task's primary metric first, and taking
// the union means an entry that lost a metric can't hide it from the table.
function metricNames(recordings) {
  const names = [];

  for (const recording of recordings ?? []) {
    for (const name of Object.keys(recording.metrics ?? {})) {
      if (!names.includes(name)) names.push(name);
    }
  }

  return names;
}

/**
 * Which dimension the rows run down. Read off the data, because it is a property of the
 * suite rather than of the caller:
 *
 *   "recording"  ts1 and ts2 score each recording separately — a row is a recording, a
 *                column pair is a metric.
 *   "region"     ts3 classifies the whole held-out population at once, so there is no
 *                recording. Its metric names carry the dimension instead: a row is a brain
 *                region and a column pair is the metric suffix, which turns 33 metrics on
 *                one row into 11 rows of 3.
 *   "metric"     neither — a row per metric. The fallback, so a score whose metric names
 *                follow no convention still renders something readable.
 */
function rowMode(recordings) {
  if ((recordings ?? []).some(recording => recording.recording_id)) return "recording";

  const names = metricNames(recordings);

  return names.length && names.every(name => name.includes(REGION_SEPARATOR))
    ? "region"
    : "metric";
}

function splitMetric(name) {
  const at = name.indexOf(REGION_SEPARATOR);

  return [name.slice(0, at), name.slice(at + 1)];
}


// ─── ROWS ───────────────────────────────────────────────────────────────────

// `n_seeds` is the largest `n` across a row's metrics: they agree in practice, and taking
// the max means a metric that failed on one seed reports the seeds the row actually has
// rather than understating them for the whole row.
function withSeeds(row, stats) {
  return stats?.n == null ? row.n_seeds : Math.max(row.n_seeds ?? 0, stats.n);
}

// One row per recording, each metric flattened into the `<name>_mean` / `<name>_sem` pair
// the columns read.
function toRecordingRows(recordings) {
  return (recordings ?? []).map(recording => {
    const row = {
      recording_id: recording.recording_id ?? null,
      label: recording.label ?? null,
      n_seeds: null,
    };

    for (const [name, stats] of Object.entries(recording.metrics ?? {})) {
      row[`${name}_mean`] = stats?.mean ?? null;
      row[`${name}_sem`] = stats?.sem ?? null;
      row.n_seeds = withSeeds(row, stats);
    }

    return row;
  });
}

// One row per brain region, columns keyed by the metric suffix. A Map so the regions keep
// the order the scorer emitted them in, which puts the aggregate "macro" row last.
function toRegionRows(recordings) {
  const rows = new Map();

  for (const recording of recordings ?? []) {
    for (const [name, stats] of Object.entries(recording.metrics ?? {})) {
      const [region, metric] = splitMetric(name);
      const row = rows.get(region) ?? { region, n_seeds: null };

      row[`${metric}_mean`] = stats?.mean ?? null;
      row[`${metric}_sem`] = stats?.sem ?? null;
      row.n_seeds = withSeeds(row, stats);

      rows.set(region, row);
    }
  }

  return [...rows.values()];
}

// The fallback shape: metric down the rows, one column each for mean and SEM.
function toMetricRows(recordings) {
  return (recordings ?? []).flatMap(recording =>
    Object.entries(recording.metrics ?? {}).map(([name, stats]) => ({
      metric: name,
      mean: stats?.mean ?? null,
      sem: stats?.sem ?? null,
      n_seeds: stats?.n ?? null,
    })),
  );
}

// Column suffixes for the region layout — "precision", "recall", "f1-score" — in first-seen
// order, so every region's columns line up.
function metricSuffixes(recordings) {
  const suffixes = [];

  for (const name of metricNames(recordings)) {
    const [, metric] = splitMetric(name);

    if (!suffixes.includes(metric)) suffixes.push(metric);
  }

  return suffixes;
}


// ─── AGGREGATION ────────────────────────────────────────────────────────────

// One entry per metric, aggregated across recordings the same way the scorers aggregate the
// primary metric into the task summary (see `task_summary` in app/scoring/ts1.py):
//
//     mean = np.mean(means)
//     sem  = np.std(means, ddof=1) / np.sqrt(n)   for n > 1, else None
//
// `ddof=1` is the sample standard deviation, so the variance divisor is n - 1 — which is
// also why the n === 1 case has to return null rather than divide by zero. Applied to a
// task's primary metric this reproduces the stored `primary_metric_mean` /
// `primary_metric_sem` exactly; the point of doing it here is to get the same pair of
// figures for the metrics the score carries no summary for.
function summariseMetric(recordings, name) {
  const means = (recordings ?? [])
    .map(recording => recording.metrics?.[name]?.mean)
    .filter(value => value != null);

  const n = means.length;

  if (n === 0) return { name, mean: null, sem: null, n };

  const mean = means.reduce((total, value) => total + value, 0) / n;

  if (n === 1) return { name, mean, sem: null, n };

  const variance = means.reduce((total, value) => total + (value - mean) ** 2, 0) / (n - 1);

  return { name, mean, sem: Math.sqrt(variance) / Math.sqrt(n), n };
}

// In the same first-seen order the columns use, so the cards above the table and the column
// pairs below it read left to right in step.
function summariseMetrics(recordings) {
  return metricNames(recordings).map(name => summariseMetric(recordings, name));
}


// ─── COLUMNS ────────────────────────────────────────────────────────────────

const SEED_COLUMN = {
  title: "n_seeds",
  field: "n_seeds",
  sorter: numericSorter,
  width: 100,
};

function labelFormatter(field) {
  return cell => {
    const row = cell.getData();
    const value = row[field] ?? row.label;

    return value ? `<span class="label">${escapeHtml(value)}</span>` : "—";
  };
}

// One column per metric, holding "mean ± sem". The title is the metric spelled the same way
// the scorer output does, so a column can be matched back to a metric name without a lookup
// table — the `_mean`/`_sem` fields behind it keep those names too.
function metricColumns(names) {
  return names.map(name => ({
    title: name,
    field: `${name}_mean`,
    formatter: scoreSemFormatter(`${name}_sem`),
    sorter: numericSorter,
    widthGrow: 1,
  }));
}

function keyedColumns(title, field, names) {
  return [
    {
      title,
      field,
      formatter: labelFormatter(field),
      widthGrow: 2,
    },
    ...metricColumns(names),
    SEED_COLUMN,
  ];
}

function metricRowColumns() {
  return [
    {
      title: "Metric",
      field: "metric",
      formatter: metricsBadgeFormatter,
      widthGrow: 2,
    },
    {
      // Mean and sem in one cell, as the task-scores grid shows them.
      title: "Score",
      field: "mean",
      formatter: scoreSemFormatter("sem"),
      sorter: numericSorter,
      width: 150,
    },
    SEED_COLUMN,
  ];
}


// ─── LAYOUTS ────────────────────────────────────────────────────────────────

// Everything that differs between the three row dimensions, in one place, so adding a suite
// with its own shape is one entry rather than a branch in four functions.
const LAYOUTS = {
  recording: {
    noun: "recording",
    searchField: "recording_id",
    searchPlaceholder: "Search recordings...",
    rows: toRecordingRows,
    columns: recordings => keyedColumns("Recording", "recording_id", metricNames(recordings)),
  },
  region: {
    noun: "region",
    searchField: "region",
    searchPlaceholder: "Search regions...",
    rows: toRegionRows,
    columns: recordings => keyedColumns("Region", "region", metricSuffixes(recordings)),
  },
  metric: {
    noun: "metric",
    searchField: "metric",
    searchPlaceholder: "Search metrics...",
    rows: toMetricRows,
    columns: metricRowColumns,
    // Nothing meaningful orders a bare metric list, so lead with the strongest.
    initialSort: [{ column: "mean", dir: "desc" }],
  },
};


// ─── TABLE ──────────────────────────────────────────────────────────────────

/**
 * Mounts the breakdown table for one task score.
 *
 * @param container   element, or the id of one. Its contents are replaced.
 * @param recordings  `score.metrics.recordings` from the API.
 * @returns the Tabulator instance.
 */
function renderRecordingScoresTable({ container, recordings }) {
  const layout = LAYOUTS[rowMode(recordings)];

  return createFilterableTable({
    container,
    rows: layout.rows(recordings),
    columns: layout.columns(recordings),
    controls: [
      {
        type: "search",
        name: layout.searchField,
        placeholder: layout.searchPlaceholder,
        match: matchIncludes(layout.searchField),
      },
    ],
    noun: layout.noun,
    // Otherwise the rows keep the order the scorer wrote them in, which for the region
    // layout puts the aggregate "macro" row last.
    initialSort: layout.initialSort,
    paginationSize: 5,
    caller: "renderRecordingScoresTable",
  });
}

/**
 * What the table will show and how much of it, for a caller that wants to say so before
 * mounting it — or to decide what belongs above it. `mode` is documented on `rowMode`.
 */
function describeRecordingScores(recordings) {
  const mode = rowMode(recordings);

  return { mode, noun: LAYOUTS[mode].noun, count: LAYOUTS[mode].rows(recordings).length };
}


// ─── FOR A CHART ────────────────────────────────────────────────────────────
//
// The same two questions the table answers — what runs down the rows, and what metrics
// were measured — asked by something that draws rather than tabulates. They live here
// because the answers depend on the suite's shape, which is this module's subject; the
// chart is then only about drawing.

/**
 * The metrics a caller may choose between for one score.
 *
 * Suffixes in the region layout, where the full name carries the region too — a TS3 score
 * measures three metrics on eleven regions, not thirty-three metrics.
 */
function recordingMetricNames(recordings) {
  return rowMode(recordings) === "region" ? metricSuffixes(recordings) : metricNames(recordings);
}

/**
 * One point per row of the table, for `metric`.
 *
 * @returns [{ key, label, mean, sem }] — `key` identifies the point across scores so two
 *          series line up on the same recording, and `label` is what an axis shows.
 */
function toRecordingPoints(recordings, metric) {
  const mode = rowMode(recordings);

  if (mode === "region") {
    return toRegionRows(recordings).map(row => ({
      key: row.region,
      label: row.region,
      mean: row[`${metric}_mean`] ?? null,
      sem: row[`${metric}_sem`] ?? null,
    }));
  }

  if (mode === "recording") {
    return toRecordingRows(recordings).map(row => ({
      key: row.recording_id,
      // Recording ids are uuids, so an axis gets the head of one and the tooltip the whole
      // thing — 29 full uuids across an axis is unreadable at any width.
      label: String(row.recording_id).slice(0, 8),
      mean: row[`${metric}_mean`] ?? null,
      sem: row[`${metric}_sem`] ?? null,
    }));
  }

  // The fallback shape has one row *per metric*, so a chosen metric is a single point.
  return toMetricRows(recordings)
    .filter(row => row.metric === metric)
    .map(row => ({ key: row.metric, label: row.metric, mean: row.mean, sem: row.sem }));
}


export {
  renderRecordingScoresTable,
  describeRecordingScores,
  recordingMetricNames,
  summariseMetrics,
  toRecordingPoints,
};
