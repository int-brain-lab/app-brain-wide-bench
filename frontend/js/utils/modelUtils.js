// A model as the pages read it: its rows, the filters over them, and the figures its
// header and dashboard show.

import { formatDate } from "../core/utils.js";
import {
  SUITES,
  suitesFromModel,
  suitesFromSubmission,
} from "../core/suites.js";
import {
  buildPretrainedBadge,
  buildSuiteBadgeList,
  buildVisibleBadge,
} from "../components/badges.js";
import {
  matchEquals,
  matchInArray,
  matchIncludes,
  optionsFromRows,
  SUITE_OPTIONS,
} from "../components/filters.js";
import { getIcon } from "../components/icons.js";

// ─── ROWS ────────────────────────────────────────────────────────────────────

function toModelRow(model) {
  return {
    id: model.id,
    name: model.name,
    team_name: model.team_name ?? null,
    created_at: model.created_at,
    n_submissions: model.n_submissions ?? 0,
    suites: model.task_suites ?? model.suites ?? [],
    is_pretrained: model.is_pretrained ?? null,
    is_mine: model.is_mine ?? false,
  };
}

function toModelRows(models) {
  return models.map(toModelRow);
}

// ─── FILTERS ─────────────────────────────────────────────────────────────────

/**
 * The filter bar over a set of model rows.
 *
 * @param rows           every row, so the selects can offer only values that appear.
 * @param showSuiteFilter off for a caller whose rows are already one suite's — the compare
 *                       page, which picks the suite above the table. Left on, the select
 *                       could only ever empty it.
 *
 * @returns the controls, in bar order — see components/filters.js.
 */
function getModelFilters(rows, { showSuiteFilter = true } = {}) {
  return [
    {
      type: "search",
      name: "name",
      placeholder: "Search models...",
      match: matchIncludes("name"),
    },
    {
      type: "select",
      name: "team_name",
      placeholder: "All teams",
      options: optionsFromRows(rows, "team_name"),
      match: matchEquals("team_name"),
    },
    ...(showSuiteFilter
      ? [
          {
            type: "select",
            name: "suite",
            placeholder: "All suites",
            options: SUITE_OPTIONS,
            match: matchInArray("suites"),
          },
        ]
      : []),
  ];
}

// ─── COVERAGE ────────────────────────────────────────────────────────────────

// What a model's submissions between them cover. A task submitted more than once counts
// once, and a submission's own `task_suites` is trusted where it has one — see
// suitesFromSubmission.
function getModelCoverage(model) {
  const submissions = model.submissions ?? [];
  const covered = new Set();
  const taskIds = new Set();

  for (const submission of submissions) {
    for (const suite of suitesFromSubmission(submission)) {
      covered.add(suite);
    }

    for (const task of submission.task_submissions ?? []) {
      taskIds.add(task.task_id);
    }
  }

  return {
    submissionCount: submissions.length,
    // In SUITES order rather than encounter order, so two models never list the same
    // coverage differently.
    suites: SUITES.filter((suite) => covered.has(suite)),
    taskCount: taskIds.size,
  };
}

// ─── RANKING ─────────────────────────────────────────────────────────────────

// Reading GET /api/models/{id}/ranking. `public` is where the model stands on the
// leaderboard today, `private` where it would stand if everything it has submitted were
// published — absent for a reader who isn't on its team. Every figure may be unplaced.

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

// ─── DISPLAY ─────────────────────────────────────────────────────────────────

function getModelSubtitle(model) {
  return [
    { text: model.team_name, icon: getIcon("team") },
    {
      text: model.created_at ? `Created ${formatDate(model.created_at)}` : null,
      icon: getIcon("created"),
    },
  ].filter((entry) => entry.text);
}

function getModelBadges(model) {
  return [
    buildSuiteBadgeList(suitesFromModel(model)),
    buildPretrainedBadge(model.is_pretrained),
    buildVisibleBadge(model.is_mine),
  ];
}

function getModelStatistics(model) {
  const { submissionCount, suites, taskCount } = getModelCoverage(model);

  return [
    ["submissions", submissionCount, getIcon("submission")],
    ["task suites", suites.length, getIcon("suite")],
    ["tasks", taskCount, getIcon("task")],
  ];
}

export {
  getModelBadges,
  getModelCoverage,
  getModelFilters,
  getModelStatistics,
  getModelSubtitle,
  markRankedRows,
  toModelRows,
  toRankRows,
};
