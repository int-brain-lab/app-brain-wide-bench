// Filterable leaderboard table: a model search plus two linked selects above a Tabulator
// grid. Rows, columns and controls only — the table plumbing is in table.js.
//
// The two linked selects are what this table has that the others don't:
//
//   grouping  Group by suite | Individual tasks — decides what `metric` offers
//   metric    the suite (Overall / TS1 / TS2 / TS3) or the individual task to rank by
//
// `metric` does two jobs at once, which is why it's a real filter and not just a view
// switch: its value names a field on the row, so `match` narrows to models that have a
// score for it, and the same value drives the score column's title, its sort and the
// ranking. Picking ts1-choice shows exactly the models scored on ts1-choice, ranked by it.

import { mean } from "../core/utils.js";
import { SUITES, suiteFromTask } from "../core/suites.js";
import {
  createFilterableTable,
  matchIncludes,
  previewRows,
  renderStaticTable,
  resolveContainer,
} from "./table.js";
import {
  modelFormatter,
  numericSorter,
  rankFormatter,
  score,
  scoreFormatter,
  suiteBarsFormatter,
} from "./formatters.js";


// ─── ROWS ───────────────────────────────────────────────────────────────────

// Keyed on the (model, team) pair rather than the model alone: a model can be reassigned to
// another team while its submissions keep the team they were made under, so one model
// legitimately holds more than one leaderboard entry.
//
// Compared on `created_at` rather than trusting the payload's order, which is an ORDER BY
// away from changing.
function latestPerModelTeam(submissions) {
  const latest = new Map();

  for (const submission of submissions) {
    const key = `${submission.model_id}|${submission.team_id}`;
    const held = latest.get(key);

    if (!held || Date.parse(submission.created_at) > Date.parse(held.created_at)) {
      latest.set(key, submission);
    }
  }

  return [...latest.values()];
}

// Every scored task becomes a field named after the task id, and every suite it touches a
// field named after the suite, so a column can bind to `ts1` or to `ts1-choice` with no
// reshaping — which is what lets the metric select switch between the two.
//
// `overall` is the mean of the suites present, not of all three: a model scored on ts1 and
// ts2 is judged on those two rather than penalised for a missing ts3.
function toLeaderboardRow(submission) {
  const scores = submission.scores ?? {};

  const row = {
    modelId: submission.model_id,
    teamId: submission.team_id,
    submissionId: submission.id,
    title: submission.model_name,
    affiliation: submission.team_name,
    createdAt: submission.created_at,
  };

  for (const [taskId, entry] of Object.entries(scores)) {
    row[taskId] = entry.mean;
  }

  for (const suite of SUITES) {
    row[suite] = mean(
      Object.entries(scores)
        .filter(([taskId]) => suiteFromTask(taskId) === suite)
        .map(([, entry]) => entry.mean)
        .filter(value => value != null),
    );
  }

  row.overall = mean(SUITES.map(suite => row[suite]).filter(value => value != null));

  return row;
}

/**
 * @param submissions the GET /api/leaderboard payload.
 * @returns one row per (model, team), ranked by `overall`.
 *
 * Ranked here rather than left to the caller, so a preview with no metric selector still
 * has `row.rank` to order by. The table re-ranks whenever its metric changes.
 */
function toLeaderboardRows(submissions) {
  const rows = latestPerModelTeam(submissions).map(toLeaderboardRow);

  assignRanks(rows, "overall");

  return rows;
}


// ─── RANKING ────────────────────────────────────────────────────────────────

/**
 * Standard competition ranking (1224) by `metric`, written onto each row in place. Ties
 * share a rank and the next is skipped; a row with no score for the metric ranks last.
 *
 * This is the model's leaderboard position, not its display order — re-sorting or filtering
 * the table doesn't change it.
 */
function assignRanks(rows, metric = "overall") {
  const byScore = [...rows].sort((a, b) => (b[metric] ?? -Infinity) - (a[metric] ?? -Infinity));

  const EPSILON = 1e-10;

  byScore.forEach((row, index) => {
    const previous = byScore[index - 1];

    // Guarded on null: `Math.abs(null - null) < EPSILON` is true, which would tie every
    // unscored row to the last scored one instead of ranking them last together.
    const tied = previous
      && row[metric] != null
      && previous[metric] != null
      && Math.abs(row[metric] - previous[metric]) < EPSILON;

    row.rank = tied ? previous.rank : index + 1;
  });
}


// ─── METRICS ────────────────────────────────────────────────────────────────

const GROUPINGS = [
  { value: "suite", label: "Group by suite" },
  { value: "task", label: "Individual tasks" },
];

// "overall" first, so a `required` select lands on it — createFilterableTable starts such a
// control on options[0].
const SUITE_METRICS = [
  { value: "overall", label: "Overall" },
  ...SUITES.map(suite => ({ value: suite, label: suite.toUpperCase() })),
];

// From the rows rather than GET /api/tasks: an option for a task no public submission has
// been scored on would filter the table to nothing.
function taskMetrics(rows) {
  const ids = new Set();

  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (key.includes("-") && suiteFromTask(key) !== null) ids.add(key);
    }
  }

  return [...ids].sort().map(taskId => ({ value: taskId, label: taskId }));
}

function metricsFor(grouping, rows) {
  return grouping === "task" ? taskMetrics(rows) : SUITE_METRICS;
}

// Everything the first render depends on — the score column's title, which suite columns
// are visible, the initial sort — is declared against this rather than applied afterwards.
const INITIAL_METRIC = SUITE_METRICS[0].value;

function metricLabel(metric) {
  return SUITE_METRICS.find(option => option.value === metric)?.label ?? metric;
}


// ─── COLUMNS ────────────────────────────────────────────────────────────────

// One score column retitled as the metric changes, rather than a column per suite: eleven
// task columns wouldn't fit beside the model and bars cells, and most would be empty.
//
// Its `field` is the synthetic "score", which no row has, and it never changes — the
// formatter and sorter read the active metric off the row instead. Pointing the field at
// the live metric is the obvious move and a trap: updateColumnDefinition finds a column
// *by its current field*, so the first swap renames the field out from under the next
// lookup and every later retitle misses.
function getLeaderboardColumns(getMetric) {
  const valueOf = row => row[getMetric()];

  return [
    {
      title: "#",
      field: "rank",
      formatter: rankFormatter,
      headerSort: false,
      width: 50,
    },
    {
      title: "Model",
      field: "title",
      formatter: modelFormatter,
      widthGrow: 2,
    },
    {
      title: metricLabel(INITIAL_METRIC),
      field: "score",
      formatter: cell => score(valueOf(cell.getData())),
      // The field holds nothing, so the comparison is on the active metric instead.
      sorter: (a, b, aRow, bRow) => numericSorter(valueOf(aRow.getData()), valueOf(bRow.getData())),
      cssClass: "overall-cell",
    },
    // The breakdown behind an Overall score, hidden by applyMetric while ranking by a single
    // suite or task. Declared visible rather than switched on after construction: Tabulator
    // builds asynchronously and discards a showColumn issued before it finishes.
    ...SUITES.map(suite => ({
      title: suite.toUpperCase(),
      field: suite,
      formatter: scoreFormatter,
      sorter: numericSorter,
      width: 90,
    })),
    {
      title: "Scores",
      field: "scores",
      headerSort: false,
      width: 150,
      formatter: suiteBarsFormatter(getMetric),
    },
  ];
}

// A score per suite rather than one metric and bars: a preview has no control to pick a
// metric with, so the spread is what carries the information. Same rows and formatters as
// the full table, so the two can't disagree about what a leaderboard row means.
function getLeaderboardPreviewColumns() {
  return [
    { title: "#", field: "rank", formatter: rankFormatter },
    { title: "Model", field: "title", formatter: modelFormatter },
    { title: "Overall", field: "overall", formatter: scoreFormatter },
    ...SUITES.map(suite => ({
      title: suite.toUpperCase(),
      field: suite,
      formatter: scoreFormatter,
    })),
  ];
}


// ─── CONTROLS ───────────────────────────────────────────────────────────────

function getLeaderboardControls() {
  return [
    {
      type: "search",
      name: "model",
      placeholder: "Search models...",
      match: matchIncludes("title"),
    },
    {
      type: "select",
      name: "grouping",
      required: true,
      options: GROUPINGS,
      // Grouping picks what `metric` offers, not which rows show, so it matches everything
      // and leaves the narrowing to the metric.
      match: () => true,
    },
    {
      type: "select",
      name: "metric",
      required: true,
      options: SUITE_METRICS,
      // The value is a field name, so this hides models with no score for it. `overall` is
      // null only for a model with nothing scored, which has nothing to rank.
      match: (row, value) => row[value] != null,
    },
  ];
}


// ─── TABLE ──────────────────────────────────────────────────────────────────

/**
 * @param container    element, or the id of one. Its contents are replaced.
 * @param submissions  the GET /api/leaderboard payload.
 * @returns the Tabulator instance.
 */
function renderLeaderboardTable({ container, submissions }) {
  const rows = toLeaderboardRows(submissions);

  // Held per call rather than at module scope, so two of these on one page can't fight over
  // it. The rows, the column definitions and initialSort below all already agree with it.
  let metric = INITIAL_METRIC;

  // Re-ranks, retitles and re-sorts. Only the title changes on the column — the field stays
  // "score" and the sorter follows `metric`, so setSort uses that stable field.
  function applyMetric(table, next) {
    metric = next;

    assignRanks(rows, metric);

    table.updateColumnDefinition("score", { title: metricLabel(metric) });

    // Overall is the only metric the per-suite columns add anything to.
    for (const suite of SUITES) {
      if (metric === "overall") table.showColumn(suite);
      else table.hideColumn(suite);
    }

    table.replaceData(rows).then(() => table.setSort("score", "desc"));
  }

  return createFilterableTable({
    container,
    rows,
    columns: getLeaderboardColumns(() => metric),
    controls: getLeaderboardControls(),
    noun: "models",
    initialSort: [{ column: "score", dir: "desc" }],
    caller: "renderLeaderboardTable",

    onControlChange: (name, value, api) => {
      if (name === "metric") {
        applyMetric(api.table, value);
        return;
      }

      if (name === "grouping") {
        // setControlOptions returns the value it settled on, so the column and the ranking
        // follow the swap without re-reading the select.
        applyMetric(api.table, api.setControlOptions("metric", metricsFor(value, rows)));
      }
    },
  });
}


// ─── STATIC TABLE ───────────────────────────────────────────────────────────

/**
 * Plain-markup counterpart to renderLeaderboardTable, for a fixed preview — no filters,
 * no paging, and no Tabulator needed on the page. Ordered by the `overall` rank
 * toLeaderboardRows assigned, the only order a preview without a metric selector has.
 *
 * @param container   element, or the id of one. Its contents are replaced.
 * @param submissions as renderLeaderboardTable.
 * @param limit       how many rows to show. Omit for all of them.
 * @returns every row it built, not just the slice it rendered, so a caller can report
 *          a total alongside the preview.
 */
function renderStaticLeaderboardTable({ container, submissions, limit }) {
  const rows = toLeaderboardRows(submissions);

  resolveContainer(container, "renderStaticLeaderboardTable").innerHTML = renderStaticTable({
    columns: getLeaderboardPreviewColumns(),
    rows: previewRows(rows, (a, b) => a.rank - b.rank, limit),
  });

  return rows;
}


export {
  renderLeaderboardTable,
  renderStaticLeaderboardTable,
};
