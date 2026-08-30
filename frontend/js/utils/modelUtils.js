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
  toModelRows,
};
