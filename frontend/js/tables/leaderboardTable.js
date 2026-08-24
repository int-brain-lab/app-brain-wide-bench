// Filterable leaderboard table: a model search plus two linked selects above a Tabulator
// grid. Rows, columns and controls only — the table plumbing is in table.js.
//
// Scores and ranks are grouped at different grains, deliberately. A score column is one
// (suite, metric) group, because averaging bacc with r2 is not arithmetic anyone should
// trust. A rank column is one whole suite, because ranks are unitless and averaging them
// across metrics is exactly what makes a cross-metric summary possible at all. So the
// overall view is five score columns beside three rank columns.
//
// The two linked selects are what this table has that the others don't:
//
//   grouping  Suites | Individual tasks — decides what `metric` offers
//   metric    which suite (or which task) to narrow to and rank by
//
// `metric` does two jobs at once, which is why it's a real filter and not just a view
// switch: it narrows to models that have a rank for it, and it drives the position. Its
// blank option, "Overall", narrows nothing and ranks across every task.

import { mean } from "../core/utils.js";
import { toMetricGroups, toSuiteGroups, toTaskOptions } from "../core/metricGroups.js";
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
  rankOrder,
  rankSorter,
  rankValue,
  score,
  scoreFormatter,
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

// Every scored task becomes a field named after the task id, and every group a field named
// after its key, so a column can bind to `ts1-choice` or to `ts1:bacc` with no reshaping —
// which is what lets the metric select switch between the two.
//
// A group's value is the mean of the tasks in it that this model was scored on, not of all
// of them: a model that skipped one r2 task is judged on the three it attempted rather than
// penalised for the fourth. The count travels alongside so the table can say so.
function toLeaderboardRow(submission, groups, suites) {
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

  // The server ranked this submission against the others in the same response — see
  // app/ranking.py. One figure per task, because every column here is a mean over some
  // subset of them and only this side knows which subset.
  row.taskRanks = submission.ranks ?? {};

  for (const group of groups) {
    const values = group.taskIds
      .map(taskId => row[taskId])
      .filter(value => value != null);

    row[group.key] = mean(values);
    row[`${group.key}/n`] = values.length;
  }

  for (const suite of suites) {
    row[suite.key] = mean(
      suite.taskIds.map(taskId => row.taskRanks[taskId]).filter(value => value != null),
    );
  }

  return row;
}

/**
 * @param submissions the GET /api/leaderboard payload.
 * @param groups      from toMetricGroups — the (suite, metric) score columns.
 * @param suites      from toSuiteGroups — the per-suite rank columns.
 * @returns one row per (model, team), ranked by mean rank.
 */
function toLeaderboardRows(submissions, groups, suites) {
  const rows = latestPerModelTeam(submissions).map(submission =>
    toLeaderboardRow(submission, groups, suites),
  );

  assignMeanRank(rows, groups);
  assignPositions(rows, row => row.meanRank, { ascending: true });

  // Sorted before it leaves, because Tabulator's initial sort on `meanRank` is a no-op
  // while every row is unranked — a stable sort of all-equal keys is the order it was
  // handed. Which is this one.
  return rows.sort(byPosition);
}


// ─── RANKING ────────────────────────────────────────────────────────────────

const EPSILON = 1e-10;

/**
 * Standard competition ranking (1224) by `valueOf`. Ties share a rank and the next is
 * skipped; a row with no value ranks last.
 *
 * Returns a Map rather than writing to the rows, because it is called once per group as
 * well as once for the leaderboard position, and only the last of those belongs on the row.
 */
function competitionRanks(rows, valueOf, { ascending = false } = {}) {
  const missing = ascending ? Infinity : -Infinity;
  const ordered = [...rows].sort((a, b) => {
    const left = valueOf(a) ?? missing;
    const right = valueOf(b) ?? missing;

    return ascending ? left - right : right - left;
  });

  const ranks = new Map();

  ordered.forEach((row, index) => {
    const previous = ordered[index - 1];

    // Guarded on null: `Math.abs(null - null) < EPSILON` is true, which would tie every
    // unscored row to the last scored one instead of ranking them last together.
    const tied = previous
      && valueOf(row) != null
      && valueOf(previous) != null
      && Math.abs(valueOf(row) - valueOf(previous)) < EPSILON;

    ranks.set(row, tied ? ranks.get(previous) : index + 1);
  });

  return ranks;
}

/**
 * The cross-group figure: the mean of the server's per-task ranks. A mean of ranks rather
 * than of scores, because ranks are unitless and the group columns are not comparable with
 * each other — which is the whole reason the columns were split by metric in the first
 * place. Over tasks rather than over group means, matching what the benchmark's own
 * `print_rank_table` calls "overall".
 *
 * Only a model scored in *every* group gets one. Averaging over "the groups you entered"
 * makes entering fewer of them strictly easier: a model ranked first in its single group
 * scores 1.00 and outranks one placed second across all five. On the current board that is
 * not an edge case — the TS1, TS2 and TS3 entrants are disjoint cohorts, so a cross-group
 * mean has no shared comparison underneath it at all.
 *
 * `groupsScored` counts groups the model has a *score* in, not a rank: a task nobody else
 * entered still produces a rank of 1, and coverage is about what was attempted.
 */
function assignMeanRank(rows, groups) {
  for (const row of rows) {
    const ranks = Object.values(row.taskRanks).filter(rank => rank != null);

    row.groupsScored = groups.filter(group => row[group.key] != null).length;

    // Two figures, deliberately. `meanRank` is the claim — it exists only where the model
    // entered every group, and it is what the column shows and the position is drawn from.
    // `partialRank` is never shown and never ranked; it exists so that unranked rows have
    // something better than insertion order to sit in. Today that is the whole board.
    row.partialRank = mean(ranks);
    row.meanRank = row.groupsScored === groups.length ? row.partialRank : null;
  }
}

// The leaderboard position, written onto each row. Not its display order — re-sorting or
// filtering the table doesn't change it.
//
// A row with no value is left unranked rather than ranked last: on the overall figure that
// is a model with partial coverage, which hasn't placed below the others so much as not
// competed against them.
function assignPositions(rows, valueOf, options) {
  const ranked = rows.filter(row => valueOf(row) != null);
  const ranks = competitionRanks(ranked, valueOf, options);

  for (const row of rows) {
    row.rank = ranks.get(row) ?? null;
  }
}

// Position first; then, for the rows that share one — every unranked row — breadth, and
// then how they placed in the groups they did enter. Neither tiebreak is a ranking claim,
// they are what keeps a table of unranked models from being in arbitrary order.
function byPosition(a, b) {
  if (a.rank !== b.rank) return rankOrder(a.rank, b.rank);

  if (a.groupsScored !== b.groupsScored) return (b.groupsScored ?? 0) - (a.groupsScored ?? 0);

  return rankOrder(a.partialRank, b.partialRank);
}


// ─── METRICS ────────────────────────────────────────────────────────────────

const GROUPINGS = [
  { value: "suite", label: "Suites" },
  { value: "task", label: "Individual tasks" },
];

// Suites rather than the five score groups: what this select picks is what the board is
// *ranked* by, and a rank exists per suite. Labelled with the bare suite — the "rank" in
// the column heading is what says these are ranks, and repeating it here would only make
// the option list wordier than the thing it names.
//
// "" first, so a `required` select lands on it — createFilterableTable starts such a control
// on options[0], and a blank value is the one createFilterableTable skips rather than
// matches, which is exactly "don't narrow".
function suiteMetrics(suites) {
  return [
    { value: "", label: "Overall" },
    ...suites.map(suite => ({ value: suite.suite, label: suite.suite.toUpperCase() })),
  ];
}

function metricsFor(grouping, groups, suites) {
  return grouping === "task" ? toTaskOptions(groups) : suiteMetrics(suites);
}

// A suite's own rank field, or a task id — the two things `metric` can name.
function rankFieldFor(metric, suites) {
  return suites.find(suite => suite.suite === metric)?.key ?? null;
}


// ─── COLUMNS ────────────────────────────────────────────────────────────────

// One column per group, all of them visible at once — five numbers fit where eleven task
// columns would not, and unlike the old per-suite trio each one is a mean of a single
// metric and so is a number the reader can actually compare down the column.
//
// `score` is a synthetic field no row has, used only in task mode where there is no column
// for the chosen task. Its `field` never changes, which is deliberate and not an oversight:
// updateColumnDefinition finds a column *by its current field*, so pointing it at the live
// metric would rename the field out from under the next lookup.
function getLeaderboardColumns(groups, suites, getMetric) {
  return [
    {
      title: "#",
      field: "rank",
      formatter: rankFormatter,
      sorter: rankSorter,
      // Not clickable — the position is what the table is already ordered by — but still
      // sorted programmatically, which is what `sorter` is here for.
      headerSort: false,
      width: 56,
    },
    {
      title: "Model",
      field: "title",
      formatter: modelFormatter,
      widthGrow: 2,
      minWidth: 180,
    },

    // ── task mode ──
    // Both synthetic: `metric` names a task, and there is no column per task. Their fields
    // never change, which is deliberate — updateColumnDefinition finds a column *by its
    // current field*, so pointing one at the live metric would rename it out from under the
    // next lookup. The formatters read the active metric off the row instead.
    {
      title: "Score",
      field: "score",
      formatter: cell => score(cell.getData()[getMetric()]),
      sorter: (a, b, aRow, bRow) =>
        numericSorter(aRow.getData()[getMetric()], bRow.getData()[getMetric()]),
      width: 110,
      hozAlign: "right",
      headerHozAlign: "right",
      cssClass: "overall-cell",
    },
    {
      title: "Rank",
      field: "taskRank",
      formatter: cell => rankValue(cell.getData().taskRanks?.[getMetric()]),
      sorter: (a, b, aRow, bRow) =>
        rankOrder(aRow.getData().taskRanks?.[getMetric()], bRow.getData().taskRanks?.[getMetric()]),
      width: 100,
      hozAlign: "right",
      headerHozAlign: "right",
    },

    // ── suite mode: the scores, at the grain a mean of them is honest ──
    ...groups.map(group => ({
      title: group.label,
      field: group.key,
      formatter: scoreFormatter,
      sorter: numericSorter,
      width: 120,
      hozAlign: "right",
      headerHozAlign: "right",
    })),

    // ── suite mode: the ranks, at the grain a mean of them means something ──
    // Which suites a model entered reads straight off these three: a dash is a suite it
    // didn't entered, which is also why the coverage count no longer needs its own column.
    ...suites.map(suite => ({
      title: suite.label,
      field: suite.key,
      formatter: cell => rankValue(cell.getValue()),
      sorter: rankSorter,
      width: 100,
      hozAlign: "right",
      headerHozAlign: "right",
      cssClass: "rank-cell",
    })),
  ];
}

// The three suite ranks and nothing else: a preview has no room for eight score columns,
// and the ranks are the summary those columns break down.
function getLeaderboardPreviewColumns(suites) {
  return [
    { title: "#", field: "rank", formatter: rankFormatter },
    { title: "Model", field: "title", formatter: modelFormatter },
    ...suites.map(suite => ({
      title: suite.label,
      field: suite.key,
      formatter: cell => rankValue(cell.getValue()),
    })),
  ];
}


// ─── CONTROLS ───────────────────────────────────────────────────────────────

function getLeaderboardControls(suites) {
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
      options: suiteMetrics(suites),
      // The value is a suite or a task id, and either way what it narrows to is models that
      // earned a rank for it. Blank — "Overall" — never reaches here: createFilterableTable
      // skips an empty control.
      match: (row, value) => (row[`${value}_rank`] ?? row.taskRanks[value]) != null,
    },
  ];
}


// ─── TABLE ──────────────────────────────────────────────────────────────────

/**
 * @param container    element, or the id of one. Its contents are replaced.
 * @param submissions  the GET /api/leaderboard payload.
 * @param tasks        the GET /api/tasks payload — the columns come from it.
 * @returns the Tabulator instance.
 */
function renderLeaderboardTable({ container, submissions, tasks }) {
  const groups = toMetricGroups(tasks);
  const suites = toSuiteGroups(tasks);
  const rows = toLeaderboardRows(submissions, groups, suites);

  // Held per call rather than at module scope, so two of these on one page can't fight over
  // it. "" is "all groups", which the rows, columns and initialSort below already agree with.
  let metric = "";

  // Re-ranks and re-sorts. `metric` is a real field in both modes now — a group key or a
  // task id — so the sort can name it directly; only task mode needs the synthetic column,
  // because there is no per-task column to sort on.
  function applyMetric(table, next) {
    metric = next ?? "";

    const rankField = rankFieldFor(metric, suites);
    const isTask = Boolean(metric) && rankField === null;

    // Every position is drawn from a rank, so every one of them is ascending: the mean
    // across all tasks, a suite's mean, or the server's figure for a single task.
    const positionOf = isTask
      ? row => row.taskRanks[metric]
      : rankField
        ? row => row[rankField]
        : row => row.meanRank;

    assignPositions(rows, positionOf, { ascending: true });

    table.updateColumnDefinition("score", { title: isTask ? metric : "Score" });

    // Suite mode is the scores and the ranks side by side; task mode swaps both sets for the
    // one task's own pair.
    for (const column of [...groups, ...suites]) {
      if (isTask) table.hideColumn(column.key);
      else table.showColumn(column.key);
    }

    for (const column of ["score", "taskRank"]) {
      if (isTask) table.showColumn(column);
      else table.hideColumn(column);
    }

    // Ordered by the position, not by the column that produced it. Sorting on the score
    // would put the rows out of order against their own `#`: on ts1's r2 tasks, CEBRA
    // outranks NDT despite the lower mean, because it wins more of the individual
    // recordings — which is the whole reason the ranking is worth having.
    table.replaceData(rows).then(() => table.setSort("rank", "asc"));
  }

  return createFilterableTable({
    container,
    rows,
    columns: getLeaderboardColumns(groups, suites, () => metric),
    controls: getLeaderboardControls(suites),
    noun: "models",
    layout: "fitColumns",
    initialSort: [{ column: "rank", dir: "asc" }],
    caller: "renderLeaderboardTable",

    onControlChange: (name, value, api) => {
      if (name === "metric") {
        applyMetric(api.table, value);
        return;
      }

      if (name === "grouping") {
        // setControlOptions returns the value it settled on, so the columns and the ranking
        // follow the swap without re-reading the select.
        applyMetric(api.table, api.setControlOptions("metric", metricsFor(value, groups, suites)));
      }
    },
  });
}


// ─── STATIC TABLE ───────────────────────────────────────────────────────────

/**
 * Plain-markup counterpart to renderLeaderboardTable, for a fixed preview — no filters,
 * no paging, and no Tabulator needed on the page. Ordered by the position
 * toLeaderboardRows assigned, the only order a preview without a metric selector has.
 *
 * @param container   element, or the id of one. Its contents are replaced.
 * @param submissions as renderLeaderboardTable.
 * @param tasks       as renderLeaderboardTable.
 * @param limit       how many rows to show. Omit for all of them.
 * @returns every row it built, not just the slice it rendered, so a caller can report
 *          a total alongside the preview.
 */
function renderStaticLeaderboardTable({ container, submissions, tasks, limit }) {
  const groups = toMetricGroups(tasks);
  const suites = toSuiteGroups(tasks);
  const rows = toLeaderboardRows(submissions, groups, suites);

  resolveContainer(container, "renderStaticLeaderboardTable").innerHTML = renderStaticTable({
    columns: getLeaderboardPreviewColumns(suites),
    rows: previewRows(rows, byPosition, limit),
  });

  return rows;
}


export {
  renderLeaderboardTable,
  renderStaticLeaderboardTable,
};
