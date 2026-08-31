// The breakdown behind one task score: every unit it was averaged over, and every metric
// measured on each. Reached by clicking a task name in the task-scores table.
//
// Rows, columns and controls only — the table plumbing is in table.js.
//
// The rows are a store's categories — recordings for ts1 and ts2, brain regions for ts3 —
// and the columns its metrics. Which of those a category is was settled when the store was
// built, in utils/recordingScoreUtils.js, so nothing here asks about the suite.

import { escapeHtml } from "../core/html.js";
import { matchIncludes } from "../components/filters.js";
import { createFilterableTable } from "./table.js";
import {
  metricsBadgeFormatter,
  numericSorter,
  buildScoreSemFormatter,
} from "./formatters.js";

// ─── ROWS ────────────────────────────────────────────────────────────────────

// One row per category, each metric flattened into the `<name>_mean` / `<name>_sem` pair the
// columns read. `field` is what the key column is called.
function toRows(store, field) {
  return [...store.index].map(([key, at]) => ({
    [field]: key,
    label: store.label,
    n_seeds: store.seeds[at],
    ...Object.fromEntries(
      Object.entries(store.metrics).flatMap(([name, values]) => [
        [`${name}_mean`, values.mean[at]],
        [`${name}_sem`, values.sem[at]],
      ]),
    ),
  }));
}

// The fallback shape: a category is a metric, so each row reads its own diagonal cell.
function toMetricRows(store) {
  return [...store.index].map(([metric, at]) => ({
    metric,
    mean: store.metrics[metric]?.mean[at] ?? null,
    sem: store.metrics[metric]?.sem[at] ?? null,
    n_seeds: store.seeds[at],
  }));
}

// ─── COLUMNS ─────────────────────────────────────────────────────────────────

const SEED_COLUMN = {
  title: "n_seeds",
  field: "n_seeds",
  sorter: numericSorter,
  width: 100,
};

function labelFormatter(field) {
  return (cell) => {
    const row = cell.getData();
    const value = row[field] ?? row.label;

    return value ? `<span class="label">${escapeHtml(value)}</span>` : "—";
  };
}

// One column per metric, holding "mean ± sem". The title is the metric spelled the same way
// the scorer output does, so a column can be matched back to a metric name without a lookup
// table — the `_mean`/`_sem` fields behind it keep those names too.
function metricColumns(names) {
  return names.map((name) => ({
    title: name,
    field: `${name}_mean`,
    formatter: buildScoreSemFormatter(`${name}_sem`),
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
      formatter: buildScoreSemFormatter("sem"),
      sorter: numericSorter,
      width: 150,
    },
    SEED_COLUMN,
  ];
}

// ─── LAYOUTS ─────────────────────────────────────────────────────────────────

// Everything that differs between the three row dimensions, in one place, so adding a suite
// with its own shape is one entry rather than a branch in four functions.
const LAYOUTS = {
  recording: {
    noun: "recording",
    searchField: "recording_id",
    searchPlaceholder: "Search recordings...",
    rows: (store) => toRows(store, "recording_id"),
    columns: (store) =>
      keyedColumns("Recording", "recording_id", Object.keys(store.metrics)),
  },
  region: {
    noun: "region",
    searchField: "region",
    searchPlaceholder: "Search regions...",
    rows: (store) => toRows(store, "region"),
    columns: (store) =>
      keyedColumns("Region", "region", Object.keys(store.metrics)),
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

// ─── TABLE ───────────────────────────────────────────────────────────────────

/**
 * Mounts the breakdown table for one task score.
 *
 * @param container element, or the id of one. Its contents are replaced.
 * @param store    from toRecordingStore — the score's breakdown.
 * @returns the Tabulator instance.
 */
function renderRecordingScoresTable({ container, store }) {
  const layout = LAYOUTS[store.group];

  const { table } = createFilterableTable({
    container,
    rows: layout.rows(store),
    columns: layout.columns(store),
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
  });

  return table;
}

export { renderRecordingScoresTable };
