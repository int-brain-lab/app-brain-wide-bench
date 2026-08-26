// Reading GET /api/models/{id}/ranking.
//
// The payload holds two rankings of the same model against the same field: `public` is
// where it stands on the leaderboard today, `private` where it would stand if everything
// it has submitted were published. `private` is absent for a reader who isn't on the
// model's team — that side is a claim about work they cannot see.
//
// Every figure may be unplaced. A suite the model never entered has no position in it, and
// the overall position is withheld until it has entered them all, so "not placed" is a
// normal answer here rather than missing data.

import { SUITES } from "./suites.js";

// Overall first, then the suites — the summary above what it summarises, as on the
// leaderboard.
const FIGURES = ["overall", ...SUITES];

function placingOf(side, figure) {
  return figure === "overall" ? side?.overall : side?.suites?.[figure];
}

/**
 * One side's standing on one figure: the position, and the size of the field it is out of.
 *
 * Not the payload's `mean_rank`. That is a mean of per-task ranks rather than a position
 * in this field — a model placed last can average halfway up it — so it answers a
 * different question from the one every reading here asks.
 */
function readPlacing(side, figure) {
  const placing = placingOf(side, figure);

  return {
    rank: placing?.rank ?? null,
    nRanked: placing?.n_ranked ?? 0,
  };
}

/**
 * @param ranking the payload, or nothing if it failed to load.
 * @returns [{ figure, label, publicSide, privateSide, coverage }] in FIGURES order.
 *
 * `coverage` is on the overall row only, and is why that row may be unplaced while the
 * suite rows beneath it are not — see the endpoint's `suites_scored`. Read off whichever
 * side the caller can see the most of, since it describes what the model has entered
 * rather than what it has published.
 */
function toRankRows(ranking) {
  const coverage = placingOf(ranking?.private ?? ranking?.public, "overall");

  return FIGURES.map((figure) => ({
    figure,
    label: figure === "overall" ? "Overall" : figure.toUpperCase(),
    publicSide: readPlacing(ranking?.public, figure),
    privateSide: readPlacing(ranking?.private, figure),
    coverage:
      figure === "overall"
        ? {
            scored: coverage?.suites_scored ?? 0,
            total: coverage?.suites_total ?? 0,
          }
        : null,
  }));
}

/**
 * Stamp each score row with the rankings its entry is currently carrying.
 *
 * The endpoint names the entry each side used for every task, and a score row is that same
 * entry — see `toScoreRow`, whose `id` is the task submission's. So the join is by id, and
 * a row that isn't the newest score for its task matches neither side and is carrying
 * nothing, which is the interesting half of the answer.
 *
 * @param rows    from toScoreRows / toScoreResultRows.
 * @param ranking the GET /api/models/{id}/ranking payload, or nothing.
 * @returns copies, each with `ranked: { public, private }` — both false where the row is
 *          superseded, and `private` always false for a reader who wasn't given that side.
 */
function markRankedRows(rows, ranking) {
  const used = {};

  for (const sides of Object.values(ranking?.tasks ?? {})) {
    for (const side of ["public", "private"]) {
      const id = sides[side]?.id;

      if (id) (used[id] ??= { public: false, private: false })[side] = true;
    }
  }

  return rows.map((row) => ({
    ...row,
    ranked: used[row.id] ?? { public: false, private: false },
  }));
}

export { markRankedRows, toRankRows };
