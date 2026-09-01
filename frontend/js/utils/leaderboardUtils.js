// The leaderboard as the page reads it: its rows, the ranking over them, and what its columns
// are measured in.
//
// The rank is the mean of the server's per-task ranks over the tasks the reader has chosen. A
// mean of ranks rather than of scores, because ranks are unitless and the metrics behind them
// are not comparable — TS1 alone carries `bacc`, `poisson_d2` and `r2`, which share neither a
// scale nor a chance level. The per-task figures come computed, see app/ranking.py, and
// choosing tasks needs no second request: ranking a model within a task doesn't depend on
// which other tasks are on screen.

import { mean } from "../core/utils.js";

// ─── ROWS ────────────────────────────────────────────────────────────────────

// Every scored task becomes a field named after the task id, so a column binds to
// `ts1-choice` with no reshaping. The score itself rides along beside its mean: the cell
// prints both halves, and the sem is not a field of its own.
function toLeaderboardRow(standing, myTeamIds) {
  const scores = standing.scores ?? {};

  const row = {
    modelId: standing.model_id,
    teamId: standing.team_id,
    model_name: standing.model_name,
    team_name: standing.team_name,
    // Both for the pills beside the name — see modelFormatter.
    isPretrained: standing.is_pretrained ?? null,
    // Worked out here rather than sent: /api/leaderboard has no notion of a caller, so it
    // says nothing about whose rows these are. Ids are compared as strings because one side
    // is JSON and the other may not be.
    isMine: myTeamIds.has(String(standing.team_id)),
    createdAt: standing.created_at,
    nSubmissions: standing.n_submissions ?? 0,
    scores,
    // The server ranked this standing against the others in the same response. One figure
    // per task, because the board's rank is a mean over whichever subset is chosen and only
    // this side knows the subset.
    taskRanks: standing.ranks ?? {},
  };

  for (const [taskId, entry] of Object.entries(scores)) {
    row[taskId] = entry;
  }

  return row;
}

/**
 * @param standings the GET /api/leaderboard payload — already one entry per model.
 * @param taskIds   the tasks the board is ranked over, in column order.
 * @param myTeamIds Set of the viewer's own team ids, as strings. Empty for a signed-out
 *                  reader, who owns none of the board.
 * @returns one row per model, in position order.
 */
function toLeaderboardRows(standings, taskIds, myTeamIds = new Set()) {
  const rows = (standings ?? []).map((standing) =>
    toLeaderboardRow(standing, myTeamIds),
  );

  assignMeanRank(rows, taskIds);
  assignPositions(rows);

  // Sorted before it leaves, because Tabulator's initial sort on `meanRank` is a no-op while
  // every row is unranked — a stable sort of all-equal keys is the order it was handed.
  return rows.sort(byPosition);
}

// ─── RANKING ─────────────────────────────────────────────────────────────────

const EPSILON = 1e-10;

/**
 * The board's figure: the mean of the server's per-task ranks over the chosen tasks.
 *
 * Only a model scored on *every* chosen task gets one. Averaging over "the ones you entered"
 * makes entering fewer strictly easier — a model ranked first on its single task scores 1.00
 * and outranks one placed second on all eight — and on this board that is not an edge case,
 * since the suites are largely disjoint cohorts.
 *
 * `partialRank` is never shown and never ranked. It exists so that unranked rows have
 * something better than insertion order to sit in.
 */
function assignMeanRank(rows, taskIds) {
  for (const row of rows) {
    const ranks = taskIds
      .map((taskId) => row.taskRanks[taskId])
      .filter((rank) => rank != null);

    row.tasksScored = taskIds.filter((taskId) => row[taskId] != null).length;
    row.partialRank = mean(ranks);
    row.meanRank =
      taskIds.length && row.tasksScored === taskIds.length
        ? row.partialRank
        : null;
  }
}

/**
 * Standard competition ranking (1224) by `meanRank`, ascending. Ties share a position and
 * the next is skipped; a row without a figure is left unranked rather than ranked last — it
 * hasn't placed below the others so much as not competed against them.
 */
function assignPositions(rows) {
  const ranked = [...rows]
    .filter((row) => row.meanRank != null)
    .sort((a, b) => a.meanRank - b.meanRank);

  const positions = new Map();

  ranked.forEach((row, index) => {
    const previous = ranked[index - 1];
    const tied =
      previous && Math.abs(row.meanRank - previous.meanRank) < EPSILON;

    positions.set(row, tied ? positions.get(previous) : index + 1);
  });

  for (const row of rows) {
    row.rank = positions.get(row) ?? null;
  }
}

// Position first; then, for the rows that share one — every unranked row — how many of the
// chosen tasks they cover, and then how they placed on those. Neither tiebreak is a ranking
// claim; they are what keeps a table of unranked models out of arbitrary order.
function byPosition(a, b) {
  if (a.rank !== b.rank) return (a.rank ?? Infinity) - (b.rank ?? Infinity);

  if (a.tasksScored !== b.tasksScored) return b.tasksScored - a.tasksScored;

  return (a.partialRank ?? Infinity) - (b.partialRank ?? Infinity);
}

// ─── COLUMNS ─────────────────────────────────────────────────────────────────

// `{ taskId: metric }` — what a task's score column is measured in, so the header can say so.
// The leaderboard payload carries the metric on each score too; this is read off the task
// table instead, which knows it whether or not anyone has been scored yet.
function toTaskMetrics(tasks) {
  return Object.fromEntries(
    (tasks ?? [])
      .filter((task) => task.id && task.primary_metric)
      .map((task) => [task.id, task.primary_metric]),
  );
}

export { toLeaderboardRows, toTaskMetrics };
