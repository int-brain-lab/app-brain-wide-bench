// Filterable leaderboard table: a model search plus two linked selects above a Tabulator
// grid. Rows, columns and controls only — the table plumbing is in table.js.
//
// Scores and ranks are shown at different grains, deliberately. A rank column is one whole
// suite, because ranks are unitless and a mean of them across metrics is a summary that
// holds. A score is shown one task at a time, because a suite-level score would average
// bacc with r2 — see core/metricGroups.js. So suite mode is three rank columns, and task
// mode is one task's score beside its rank.
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
import {
  toSuiteGroups,
  toTaskMetrics,
  toTaskOptions,
} from "../core/metricGroups.js";
import {
  createFilterableTable,
  matchIncludes,
  previewRows,
  renderStaticTable,
} from "./table.js";
import {
  modelFormatter,
  numericSorter,
  rankFormatter,
  rankOrder,
  rankSorter,
  rankValue,
  score,
} from "./formatters.js";
import { resolveContainer } from "../core/dom.js";

// ─── ROWS ───────────────────────────────────────────────────────────────────

// Every scored task becomes a field named after the task id, and every suite a field named
// after its key, so a column can bind to `ts1-choice` or to `ts1_rank` with no reshaping —
// which is what lets the metric select switch between the two.
function toLeaderboardRow(standing, suites, myTeamIds) {
  const scores = standing.scores ?? {};

  const row = {
    modelId: standing.model_id,
    teamId: standing.team_id,
    // The newest submission behind the standing — what the row links to. The scores beside
    // it may each come from an older one, which is why they carry their own submission id.
    submissionId: standing.id,
    title: standing.model_name,
    affiliation: standing.team_name,
    // Both for the pills beside the name — see modelFormatter. Nothing filters or sorts on
    // either.
    isPretrained: standing.is_pretrained ?? null,
    // Worked out here rather than sent: /api/leaderboard has no notion of a caller, so it
    // says nothing about whose rows these are. Ids are compared as strings because one
    // side is JSON and the other may not be.
    isMine: myTeamIds.has(String(standing.team_id)),
    createdAt: standing.created_at,
    nSubmissions: standing.n_submissions ?? 0,
  };

  for (const [taskId, entry] of Object.entries(scores)) {
    row[taskId] = entry.mean;
  }

  // The scores themselves as well as their means: each says which entry it came from, which
  // is what lets a reader compare this row's score on one task against another row's — see
  // the comparison the page mounts under the board.
  row.scores = scores;

  // The server ranked this standing against the others in the same response — see
  // app/ranking.py. One figure per task, because every column here is a mean over some
  // subset of them and only this side knows which subset.
  row.taskRanks = standing.ranks ?? {};

  for (const suite of suites) {
    row[suite.key] = mean(
      suite.taskIds
        .map((taskId) => row.taskRanks[taskId])
        .filter((value) => value != null),
    );
  }

  return row;
}

/**
 * @param standings   the GET /api/leaderboard payload — already one entry per model.
 * @param suites      from toSuiteGroups — the per-suite rank columns.
 * @param myTeamIds   Set of the viewer's own team ids, as strings. Empty for a signed-out
 *                    reader, who owns none of the board.
 * @returns one row per model, ranked by mean rank.
 */
function toLeaderboardRows(standings, suites, myTeamIds = new Set()) {
  const rows = standings.map((standing) =>
    toLeaderboardRow(standing, suites, myTeamIds),
  );

  assignMeanRank(rows, suites);
  assignPositions(rows, (row) => row.meanRank, { ascending: true });

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
 * Returns a Map rather than writing to the rows, so the caller decides what the position
 * it produced is called — assignPositions writes it as `rank`, and re-runs it whenever the
 * metric select changes what the board is ranked by.
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
    const tied =
      previous &&
      valueOf(row) != null &&
      valueOf(previous) != null &&
      Math.abs(valueOf(row) - valueOf(previous)) < EPSILON;

    ranks.set(row, tied ? ranks.get(previous) : index + 1);
  });

  return ranks;
}

/**
 * The cross-suite figure: the mean of the server's per-task ranks. A mean of ranks rather
 * than of scores, because ranks are unitless and the metrics behind them are not comparable
 * with each other. Over tasks rather than over the suite means, matching what the
 * benchmark's own `print_rank_table` calls "overall".
 *
 * Only a model scored in *every suite* gets one. Averaging over "the suites you entered"
 * makes entering fewer of them strictly easier: a model ranked first in its single suite
 * scores 1.00 and outranks one placed second across all three. On the current board that is
 * not an edge case — the TS1, TS2 and TS3 entrants are disjoint cohorts, so a cross-suite
 * mean has no shared comparison underneath it at all.
 *
 * `suitesScored` counts suites the model has a *score* in, not a rank: a task nobody else
 * entered still produces a rank of 1, and coverage is about what was attempted.
 */
function assignMeanRank(rows, suites) {
  for (const row of rows) {
    const ranks = Object.values(row.taskRanks).filter((rank) => rank != null);

    row.suitesScored = suites.filter((suite) =>
      suite.taskIds.some((taskId) => row[taskId] != null),
    ).length;

    // Two figures, deliberately. `meanRank` is the claim — it exists only where the model
    // entered every suite, and it is what the column shows and the position is drawn from.
    // `partialRank` is never shown and never ranked; it exists so that unranked rows have
    // something better than insertion order to sit in. Today that is the whole board.
    row.partialRank = mean(ranks);
    row.meanRank = row.suitesScored === suites.length ? row.partialRank : null;
  }
}

// The leaderboard position, written onto each row. Not its display order — re-sorting or
// filtering the table doesn't change it.
//
// A row with no value is left unranked rather than ranked last: on the overall figure that
// is a model with partial coverage, which hasn't placed below the others so much as not
// competed against them.
function assignPositions(rows, valueOf, options) {
  const ranked = rows.filter((row) => valueOf(row) != null);
  const ranks = competitionRanks(ranked, valueOf, options);

  for (const row of rows) {
    row.rank = ranks.get(row) ?? null;
  }
}

// Position first; then, for the rows that share one — every unranked row — breadth, and
// then how they placed in the suites they did enter. Neither tiebreak is a ranking claim,
// they are what keeps a table of unranked models from being in arbitrary order.
function byPosition(a, b) {
  if (a.rank !== b.rank) return rankOrder(a.rank, b.rank);

  if (a.suitesScored !== b.suitesScored)
    return (b.suitesScored ?? 0) - (a.suitesScored ?? 0);

  return rankOrder(a.partialRank, b.partialRank);
}

// ─── METRICS ────────────────────────────────────────────────────────────────

const GROUPINGS = [
  { value: "suite", label: "Suites" },
  { value: "task", label: "Individual tasks" },
];

// What this select picks is what the board is *ranked* by, and a rank exists per suite.
// Labelled with the bare suite — the "rank" in
// the column heading is what says these are ranks, and repeating it here would only make
// the option list wordier than the thing it names.
//
// "" first, so a `required` select lands on it — createFilterableTable starts such a control
// on options[0], and a blank value is the one createFilterableTable skips rather than
// matches, which is exactly "don't narrow".
function suiteMetrics(suites) {
  return [
    { value: "", label: "Overall" },
    ...suites.map((suite) => ({
      value: suite.suite,
      label: suite.suite.toUpperCase(),
    })),
  ];
}

function metricsFor(grouping, suites) {
  return grouping === "task" ? toTaskOptions(suites) : suiteMetrics(suites);
}

// A suite's own rank field, or a task id — the two things `metric` can name.
function rankFieldFor(metric, suites) {
  return suites.find((suite) => suite.suite === metric)?.key ?? null;
}

// ─── COLUMNS ────────────────────────────────────────────────────────────────

// Suite mode is the three rank columns and nothing else: a mean rank is the only summary a
// suite has, so the numbers a reader compares down the board are these. The scores behind
// them are one metric select away, per task, where they are comparable.
//
// `score` is a synthetic field no row has, used only in task mode where there is no column
// for the chosen task. Its `field` never changes, which is deliberate and not an oversight:
// updateColumnDefinition finds a column *by its current field*, so pointing it at the live
// metric would rename the field out from under the next lookup.
function getLeaderboardColumns(suites, getMetric) {
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
      widthGrow: 1.5,
    },

    // ── task mode ──
    // Both synthetic: `metric` names a task, and there is no column per task. Their fields
    // never change, which is deliberate — updateColumnDefinition finds a column *by its
    // current field*, so pointing one at the live metric would rename it out from under the
    // next lookup. The formatters read the active metric off the row instead.
    {
      title: "Score",
      field: "score",
      formatter: (cell) => score(cell.getData()[getMetric()]),
      sorter: (a, b, aRow, bRow) =>
        numericSorter(aRow.getData()[getMetric()], bRow.getData()[getMetric()]),
      hozAlign: "right",
      headerHozAlign: "right",
      cssClass: "overall-cell",
    },
    {
      title: "Rank",
      field: "taskRank",
      formatter: (cell) => rankValue(cell.getData().taskRanks?.[getMetric()]),
      sorter: (a, b, aRow, bRow) =>
        rankOrder(
          aRow.getData().taskRanks?.[getMetric()],
          bRow.getData().taskRanks?.[getMetric()],
        ),
      hozAlign: "right",
      headerHozAlign: "right",
    },

    // ── suite mode: the ranks, at the grain a mean of them means something ──
    // Which suites a model entered reads straight off these three: a dash is a suite it
    // didn't entered, which is also why the coverage count no longer needs its own column.
    ...suites.map((suite) => ({
      title: suite.label,
      field: suite.key,
      formatter: (cell) => rankValue(cell.getValue()),
      sorter: rankSorter,
      hozAlign: "right",
      headerHozAlign: "right",
      cssClass: "rank-cell",
    })),
  ];
}

// The same three suite ranks the full table shows, minus the sorters and the widths a
// static preview has no use for.
function getLeaderboardPreviewColumns(suites) {
  return [
    { title: "#", field: "rank", formatter: rankFormatter },
    { title: "Model", field: "title", formatter: modelFormatter },
    ...suites.map((suite) => ({
      title: suite.label,
      field: suite.key,
      formatter: (cell) => rankValue(cell.getValue()),
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
      match: (row, value) =>
        (row[`${value}_rank`] ?? row.taskRanks[value]) != null,
    },
  ];
}

// ─── TABLE ──────────────────────────────────────────────────────────────────

/**
 * @param container    element, or the id of one. Its contents are replaced.
 * @param standings    the GET /api/leaderboard payload.
 * @param tasks        the GET /api/tasks payload — the columns come from it.
 * @param myTeamIds    Set of the viewer's own team ids, as strings, for the "Yours" pill.
 *                     Omit for no pill — see toLeaderboardRows.
 * @param selection    optional, as createFilterableTable — with whatever the metric select
 *                     is on added to the context its `onChange` is given, since what a
 *                     selection *means* depends on it: a task id makes the rows comparable,
 *                     a suite or "Overall" doesn't.
 * @param onRowClick   optional (row, metric, {event, element}) => void. The metric comes
 *                     along for the same reason it does on `selection`: a row means one
 *                     score only when the board is showing one task.
 * @returns the Tabulator instance.
 */
function renderLeaderboardTable({
  container,
  standings,
  tasks,
  myTeamIds,
  selection,
  onRowClick,
}) {
  const suites = toSuiteGroups(tasks);
  const metrics = toTaskMetrics(tasks);
  const rows = toLeaderboardRows(standings, suites, myTeamIds);

  // Held per call rather than at module scope, so two of these on one page can't fight over
  // it. "" is "overall", which the rows, columns and initialSort below already agree with.
  let metric = "";

  // Re-ranks and re-sorts. `metric` is a real field in both modes — a suite's rank field or
  // a task id — so the sort can name it directly; only task mode needs the synthetic
  // columns, because there is no per-task column to sort on.
  function applyMetric(table, next) {
    metric = next ?? "";

    const rankField = rankFieldFor(metric, suites);
    const isTask = Boolean(metric) && rankField === null;

    // Every position is drawn from a rank, so every one of them is ascending: the mean
    // across all tasks, a suite's mean, or the server's figure for a single task.
    const positionOf = isTask
      ? (row) => row.taskRanks[metric]
      : rankField
        ? (row) => row[rankField]
        : (row) => row.meanRank;

    assignPositions(rows, positionOf, { ascending: true });

    // The metric rides along in the heading, since a bare task id doesn't say what its
    // number is measured in and suite mode no longer has a column that does. A task the
    // table doesn't know the metric for keeps the bare id rather than an empty bracket.
    const scoreTitle = !isTask
      ? "Score"
      : metrics[metric]
        ? `${metric} (${metrics[metric]})`
        : metric;

    table.updateColumnDefinition("score", { title: scoreTitle });

    // Task mode swaps the suite ranks for the one task's own score and rank.
    for (const column of suites) {
      if (isTask) table.hideColumn(column.key);
      else table.showColumn(column.key);
    }

    for (const column of ["score", "taskRank"]) {
      if (isTask) table.showColumn(column);
      else table.hideColumn(column);
    }

    // A tick means something in both modes, but not the same thing: on a task it picks
    // scores to compare, on a suite it picks models. Either way what was ticked under the
    // old metric was ticked for a question nobody is asking any more.
    if (selection) table.deselectRow();

    // Ordered by the position, not by the column that produced it. Sorting on the score
    // would put the rows out of order against their own `#`: on ts1's r2 tasks, CEBRA
    // outranks NDT despite the lower mean, because it wins more of the individual
    // recordings — which is the whole reason the ranking is worth having.
    table.replaceData(rows).then(() => table.setSort("rank", "asc"));
  }

  return createFilterableTable({
    container,
    rows,
    columns: getLeaderboardColumns(suites, () => metric),
    controls: getLeaderboardControls(suites),
    noun: "model",
    layout: "fitColumns",
    initialSort: [{ column: "rank", dir: "asc" }],
    // A row is a standing, and the newest submission behind it is the only id it carries.
    index: "submissionId",
    caller: "renderLeaderboardTable",

    ...(onRowClick
      ? { onRowClick: (row, context) => onRowClick(row, metric, context) }
      : {}),

    ...(selection
      ? {
          selection: {
            ...selection,
            // The metric rides along because the rows alone don't say what they are
            // selected *for* — see the parameter's note. Spread rather than rebuilt, so
            // everything else the caller asked for — `claimLinks` — still reaches the table.
            onChange: (rows, context) =>
              selection.onChange(rows, { ...context, metric }),
          },
        }
      : {}),

    onControlChange: (name, value, api) => {
      if (name === "metric") {
        applyMetric(api.table, value);
        return;
      }

      if (name === "grouping") {
        // setControlOptions returns the value it settled on, so the columns and the ranking
        // follow the swap without re-reading the select.
        applyMetric(
          api.table,
          api.setControlOptions("metric", metricsFor(value, suites)),
        );
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
 * @param standings   as renderLeaderboardTable.
 * @param tasks       as renderLeaderboardTable.
 * @param limit       how many rows to show. Omit for all of them.
 * @param viewAll     as renderStaticTable — where the footer's "View all" link goes.
 * @param myTeamIds   as renderLeaderboardTable. Omit for no "Yours" pill, which is what a
 *                    preview that isn't worth an extra request for the memberships does.
 * @returns every row it built, not just the slice it rendered, so a caller can report
 *          a total alongside the preview.
 */
function renderStaticLeaderboardTable({
  container,
  standings,
  tasks,
  limit,
  viewAll,
  myTeamIds,
}) {
  const suites = toSuiteGroups(tasks);
  const rows = toLeaderboardRows(standings, suites, myTeamIds);

  const shown = previewRows(rows, byPosition, limit);

  resolveContainer(container).innerHTML = renderStaticTable({
    columns: getLeaderboardPreviewColumns(suites),
    rows: shown,
    noun: "model",
    total: rows.length,
    viewAll,
  });

  return rows;
}

export { renderLeaderboardTable, renderStaticLeaderboardTable };
