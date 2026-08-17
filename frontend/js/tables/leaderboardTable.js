// Filterable leaderboard table: a model search plus two linked selects above a Tabulator
// grid. All the table plumbing lives in utils/tables.js — this module is just the rows, the
// columns and the three controls, same as modelTable.js and submissionTable.js.
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
//
// Row building lives here too (it was js/scores/leaderboardRows.js): turning the
// per-submission payload into one row per (model, team) is this table's shape, not shared
// score maths. What is shared — SUITES, suiteOf, mean — comes from scores/scoreMaths.js.

import { escapeHtml, mean} from "../core/utils.js";
import { SUITES, suiteFromTask } from "../core/suites.js";
import { createFilterableTable, matchIncludes, numericSorter, score } from "./table.js";


// ─── ROWS ───────────────────────────────────────────────────────────────────

// One row per (model_id, team_id), carrying the scores of that pair's most recent
// submission.
//
// The pair is the key rather than the model alone because a model can be reassigned to a
// different team (PATCH /api/models/{id}) while its submissions keep the team they were made
// under — so one model legitimately appears under more than one team, and those are
// different entries on a leaderboard.
//
// Compared on `created_at` rather than trusting the payload's order: the endpoint does sort
// newest-first today, but a row builder that silently depends on that breaks the day
// someone changes the ORDER BY.
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
// field named after the suite. A column can then bind to `ts1` or to `ts1-choice` with no
// reshaping — which is what lets the metric select switch between the two.
//
// `overall` is the mean of the suites present, not of all three: a model scored on ts1 and
// ts2 is judged on those two rather than penalised for a missing ts3.
function toRow(submission) {
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
 * Ranked here rather than left to the caller because js/landing.js sorts its top-five
 * preview on `row.rank` and has no metric of its own. The table re-ranks whenever its
 * metric changes, which layers on top rather than duplicating this.
 */
function toRows(submissions) {
  const rows = latestPerModelTeam(submissions).map(toRow);

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

// "overall" first, so a `required` select lands on it by default — createFilterableTable
// starts such a control on options[0].
const SUITE_METRICS = [
  { value: "overall", label: "Overall" },
  ...SUITES.map(suite => ({ value: suite, label: suite.toUpperCase() })),
];

// Task options come from the rows rather than GET /api/tasks — the same reasoning as
// modelTable's team select: an option for a task no public submission has been scored on
// would filter the table to nothing. Sorted, so they read ts1-… then ts2-… then ts3-….
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

// What the table shows before any control is touched. Everything the first render depends
// on — the score column's title, which suite columns are visible, the initial sort — is
// declared against this rather than applied afterwards.
const INITIAL_METRIC = SUITE_METRICS[0].value;

function metricLabel(metric) {
  return SUITE_METRICS.find(option => option.value === metric)?.label ?? metric;
}


// ─── FORMATTERS ─────────────────────────────────────────────────────────────

// Tabulator inserts a formatter's return value as HTML, so each of these is an innerHTML
// sink — and `title`/`affiliation` are model and team names as typed by users. This is the
// public leaderboard, the widest-reach injection point in the app, hence escapeHtml on
// every interpolation.

const MEDAL_CLASSES = { 1: "rank-gold", 2: "rank-silver", 3: "rank-bronze" };

// The suite bars beside the score. Their own list because a bar needs a colour class,
// which the metric options don't carry.
const SUITE_BARS = SUITES.map(suite => ({ key: suite, label: suite.toUpperCase(), cls: suite }));

// Returns markup rather than reaching for cell.getElement() and setting classes on the td.
// That's what lets the same formatter serve renderStaticTable, whose faked cell offers only
// getValue and getData — and the medal rules are plain colour/weight with no element
// selector, so they apply to a span exactly as they did to a cell.
function rankFormatter(cell) {
  const rank = cell.getValue();
  const medal = MEDAL_CLASSES[rank];

  return medal ? `<span class="${medal}">${escapeHtml(rank)}</span>` : String(rank ?? "");
}

function scoreFormatter(cell) {
  return score(cell.getValue());
}

function modelFormatter(cell) {
  const row = cell.getData();

  return `
    <a href="/html/models/models.html?id=${encodeURIComponent(row.modelId)}" class="column">
      <div class="label">${escapeHtml(row.title)}</div>
      <div class="metadata">${escapeHtml(row.affiliation)}</div>
    </a>
  `;
}


// ─── COLUMNS ────────────────────────────────────────────────────────────────

// One score column, retitled as the metric changes, rather than a column per suite. That's
// what makes task-level grouping possible: eleven task columns wouldn't fit beside the
// model and bars cells, and most would be empty for any given model.
//
// Its `field` is the synthetic "score", which no row has, and it never changes — the
// formatter and sorter read the active metric off the row instead. Pointing the field at
// the live metric is the obvious move and a trap: updateColumnDefinition finds a column
// *by its current field*, so the first swap renames the field out from under the next
// lookup and every later retitle misses.
//
// `metric` is threaded through a closure rather than read from module state, so two of
// these tables on one page couldn't fight over it.
function getColumns(getMetric) {
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
      // Tabulator sorts on the field by default, and this column's field holds nothing —
      // so the comparison is on the active metric, through the shared null-last sorter.
      sorter: (a, b, aRow, bRow) => numericSorter(valueOf(aRow.getData()), valueOf(bRow.getData())),
      cssClass: "overall-cell",
    },
    // The per-suite breakdown, shown only while ranking by Overall — there the single score
    // column is an average of these three, so seeing the parts beside the whole is the
    // point. Ranking by one suite or one task makes them noise, and applyMetric hides them.
    //
    // Visible by default, because INITIAL_METRIC is Overall. They were declared hidden and
    // switched on by an applyMetric call right after construction, which silently did
    // nothing: Tabulator builds asynchronously and discards showColumn/hideColumn issued
    // before it finishes, so the columns only appeared once a control was touched. The
    // first render now comes entirely from these definitions and `initialSort`.
    ...SUITES.map(suite => ({
      title: suite.toUpperCase(),
      field: suite,
      formatter: scoreFormatter,
      sorter: numericSorter,
      width: 90,
    })),
    {
      // All three suites while ranking by Overall, otherwise just the one being ranked by —
      // an individual task shows its own suite's bar, since the task is part of that score.
      title: "Scores",
      field: "scores",
      headerSort: false,
      width: 150,
      formatter: cell => {
        const row = cell.getData();
        const metric = getMetric();
        const bars = metric === "overall"
          ? SUITE_BARS
          : SUITE_BARS.filter(bar => bar.key === suiteFromTask(metric));

        return `<div class="column gap-sm">${bars.map(bar => {
          const percent = row[bar.key] == null ? 0 : Math.round(row[bar.key] * 100);

          return `
            <div class="row gap-sm">
              <span class="metadata">${escapeHtml(bar.label)}</span>
              <div class="bar-track">
                <div class="bar ${escapeHtml(bar.cls)}" style="width:${percent}%"></div>
              </div>
            </div>
          `;
        }).join("")}</div>`;
      },
    },
  ];
}


// The landing page's five-row preview shows a score per suite rather than one metric and
// bars: it has no controls to pick a metric with, so the per-suite spread is what carries
// the information. A different column set, but built from the same rows and the same
// formatters, so the two can't disagree about what a leaderboard row means.
//
// No `sorter` on these — a static table doesn't sort, and the caller has already ordered
// the rows by rank.
function getPreviewColumns() {
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

function getControls() {
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
      // Grouping picks what `metric` offers, not which rows show — so it matches everything
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


/**
 * @param container    element, or the id of one. Its contents are replaced.
 * @param submissions  the GET /api/leaderboard payload.
 * @returns the Tabulator instance.
 */
function renderLeaderboardTable({ container, submissions }) {
  const rows = toRows(submissions);

  // Which metric the table is ranked by. Held here rather than at module scope so it
  // belongs to this table instance. toRows has already ranked by it, and the column
  // definitions and initialSort below are written for it, so nothing has to be applied to
  // get the first render right.
  let metric = INITIAL_METRIC;

  // Re-ranks, retitles and re-sorts. Only the title changes on the column — the field
  // stays "score" and the sorter follows `metric`, so setSort uses that stable field.
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

  const table = createFilterableTable({
    container,
    rows,
    columns: getColumns(() => metric),
    controls: getControls(),
    noun: "models",
    initialSort: [{ column: "score", dir: "desc" }],
    caller: "renderLeaderboardTable",

    onControlChange: (name, value, api) => {
      if (name === "metric") {
        applyMetric(api.table, value);
        return;
      }

      if (name === "grouping") {
        // Returns the value it settled on — the first option of the new list — so the
        // column and the ranking follow the swap without re-reading the select.
        applyMetric(api.table, api.setControlOptions("metric", metricsFor(value, rows)));
      }
    },
  });

  return table;
}


export {
  renderLeaderboardTable,
  toRow,
  toRows,
  assignRanks,
  // Exported so the landing page can render a preview from the same rows and formatters
  // via renderStaticTable — one definition of what a leaderboard row looks like.
  getPreviewColumns as leaderboardPreviewColumns,
};
