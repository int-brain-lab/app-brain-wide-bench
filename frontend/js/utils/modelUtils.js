// A model as the pages read it: its rows, the filters over them, and the figures its
// header and dashboard show.

import { formatDate } from "../core/utils.js";
import { SUITES, suiteLabel, suitesFromModel, suitesFromSubmission } from "../core/suites.js";
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
      type: "pinned",
      name: "team_name",
      label: "Team",
      options: optionsFromRows(rows, "team_name"),
      match: matchEquals("team_name"),
    },
    ...(showSuiteFilter
      ? [
          {
            type: "pinned",
            name: "suite",
            label: "Suite",
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
 * Every figure the benchmark has, in reading order.
 *
 * All of them whether or not the model has placed: a suite it has never entered is a row of
 * dashes, which is what says there is nothing there — and the card is read against the
 * others beside it, so the rows have to be the same rows every time.
 *
 * `coverage` is on the overall row only — see the endpoint's `suites_scored`, which is what
 * withholds that position until every suite is entered. Read off whichever side the caller
 * can see the most of, since it describes what the model has entered rather than what it
 * has published.
 *
 * @param ranking the payload, or nothing if it failed to load.
 * @returns [{ figure, label, publicSide, privateSide, coverage }] — the summary above what
 *          it summarises, then the suites in SUITES order.
 */
function toRankRows(ranking) {
  const overall = placingOf(ranking?.private ?? ranking?.public, "overall");

  return ["overall", ...SUITES].map((figure) => ({
    figure,
    label: figure === "overall" ? "Overall" : suiteLabel(figure),
    publicSide: readPlacing(ranking?.public, figure),
    privateSide: readPlacing(ranking?.private, figure),
    coverage:
      figure === "overall"
        ? {
            scored: overall?.suites_scored ?? 0,
            total: overall?.suites_total ?? 0,
          }
        : null,
  }));
}

/**
 * Stamp each score row with what its entry is currently carrying.
 *
 * The endpoint names the entry each side used for every task, and a score row is that same
 * entry — see `toScoreRow`, whose `id` is the task submission's. So the join is by id, and
 * a row that isn't the newest score for its task matches neither side and is carrying
 * nothing, which is the interesting half of the answer.
 *
 * `latest` is the private side where the reader was given one: that ranking is computed over
 * every submission, so its entry for a task is the newest score of it — see latest_entries in
 * app/ranking/rank.py. Without that side it falls back to the public entry, which for a reader
 * who can only see public submissions is the newest score there is to see.
 *
 * @param rows    from toScoreRows / toScoreResultRows.
 * @param ranking the GET /api/models/{id}/ranking payload, or nothing.
 * The entry also carries where it placed on its own task, a narrower field than the suite
 * figures above it — see TaskEntryRef in app/schemas/models.py.
 *
 * @returns copies, each with `ranked: { public, latest }` — both false where the row has been
 *          superseded — and `rank` / `nRanked`, null and 0 for a row carrying nothing.
 */
function markRankedRows(rows, ranking) {
  const ranked = new Map();
  const latest = new Map();

  // The side that says which score is the newest, which is the private one wherever the
  // reader has it.
  const newest = ranking?.private ? "private" : "public";

  for (const sides of Object.values(ranking?.tasks ?? {})) {
    if (sides.public?.id) ranked.set(sides.public.id, sides.public);
    if (sides[newest]?.id) latest.set(sides[newest].id, sides[newest]);
  }

  return rows.map((row) => {
    // The newest side's placing wherever the row is that side's entry, since that is the
    // standing being shown; a row that is only the public entry is read off the public side
    // instead. Where both name it the ranks agree — same score, same competitors.
    const placed = latest.get(row.id) ?? ranked.get(row.id);

    return {
      ...row,
      ranked: { public: ranked.has(row.id), latest: latest.has(row.id) },
      rank: placed?.rank ?? null,
      nRanked: placed?.n_ranked ?? 0,
    };
  });
}

/**
 * Whether the model is holding back work the leaderboard has not seen.
 *
 * Which is the question the private ranking answers, and the one that decides whether it is
 * worth showing: a team whose every current score is already public would be shown the same
 * figure twice.
 *
 * @param rows from markRankedRows.
 *
 * @returns true where any current score is not the one the public ranking stands on.
 */
function hasPrivateOnlyScores(rows) {
  return rows.some((row) => row.ranked.latest && !row.ranked.public);
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

// Whether anything of the model can be seen from outside its team: one public submission is
// enough. A model has no visibility of its own — see ModelSubmissionOut in
// app/schemas/models.py, which is where the field lives.
function isModelPublic(model) {
  return (model.submissions ?? []).some((submission) => submission.is_public);
}

function getModelBadges(model) {
  return [
    buildSuiteBadgeList(suitesFromModel(model)),
    buildPretrainedBadge(model.is_pretrained),
    buildVisibleBadge(isModelPublic(model)),
  ];
}

export {
  getModelBadges,
  hasPrivateOnlyScores,
  getModelCoverage,
  getModelFilters,
  getModelSubtitle,
  markRankedRows,
  toModelRows,
  toRankRows,
};
