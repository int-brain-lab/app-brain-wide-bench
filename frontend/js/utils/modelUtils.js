// A model as the pages read it: its rows, the filters over them, and the figures its
// header and dashboard show.

import {
  buildPretrainedBadge,
  buildSuiteBadgeList,
  buildVisibleBadge,
} from "../components/badges.js";
import { getIcon } from "../components/icons.js";
import {
  matchEquals,
  matchInArray,
  matchIncludes,
  optionsFromRows,
  SUITE_OPTIONS,
} from "../components/filters.js";
import { formatDate } from "../core/utils.js";
import {
  countTasks,
  getMeanScores,
  scoresBySuite,
} from "../core/scoreData.js";

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

export function toModelRows(models) {
  return models.map(toModelRow);
}

function toModelMap(models) {
  const modelMap = new Map();
  for (const model of models) {
    modelMap.set(model.id, toModelRow(model));
  }
  return modelMap;
}

function modelRowToMap(modelRows) {
  const modelMap = new Map();
  for (const model of modelRows) {
    modelMap.set(model.id, model);
  }
  return modelMap;
}

// ─── DISPLAY ─────────────────────────────────────────────────────────────────

export function getModelSubtitle(model) {
  return [
    { text: model.team_name, icon: getIcon("team") },
    {
      text: model.created_at ? `Created ${formatDate(model.created_at)}` : null,
      icon: getIcon("created"),
    },
  ].filter((entry) => entry.text);
}

export function getModelBadges(model) {
  return [
    buildSuiteBadgeList(model.task_suites ?? model.suites ?? []),
    buildPretrainedBadge(model.is_pretrained),
    buildVisibleBadge(model.is_mine),
  ];
}

export function getModelStatistics(model) {
  const { submissions, meanScores, taskCount } = getDashboardData(model);

  return [
    ["submissions", submissions.length, getIcon("submission")],
    ["task suites", Object.keys(meanScores).length - 1, getIcon("suite")],
    ["tasks", taskCount, getIcon("task")],
  ];
}

function getDashboardData(model) {
  const submissions = model.submissions ?? [];
  const suiteScores = scoresBySuite(submissions);
  const meanScores = getMeanScores(suiteScores);

  return {
    submissions,
    meanScores,
    taskCount: countTasks(suiteScores),
  };
}

// ─── FILTERS ─────────────────────────────────────────────────────────────────

// `showSuiteFilter` off for a caller whose rows are already one suite's — the compare page,
// which picks the suite above the table. Left on, the select could only ever empty it.
export function getModelFilters(rows, { showSuiteFilter = true } = {}) {
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
