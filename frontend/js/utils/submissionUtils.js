// A submission as the pages read it: its rows, the filters over them, and the figures
// its header and dashboard show.

import { suitesFromSubmission } from "../core/suites.js";
import { formatDate } from "../core/utils.js";
import {
  buildStatusBadge,
  buildSuiteBadgeList,
  buildVisibleBadge,
} from "../components/badges.js";
import {
  matchEquals,
  matchInArray,
  matchIncludes,
  SUITE_OPTIONS,
} from "../components/filters.js";
import { getIcon } from "../components/icons.js";

// ─── ROWS ────────────────────────────────────────────────────────────────────

function toSubmissionRow(submission) {
  return {
    id: submission.id,
    label: submission.label,
    // Always mapped, even though only the `showModel` columns render them: it costs
    // nothing, and it keeps one row shape whichever caller built the table.
    model_name: submission.model_name ?? null,
    team_name: submission.team_name ?? null,
    updated_at: submission.updated_at,
    status: submission.status,
    // On the row rather than fetched with the detail: it is on every response a listing
    // returns, and the comparison's details panel is one of the things that reads it.
    is_public: submission.is_public ?? null,
    suites: suitesFromSubmission(submission),
  };
}

/**
 * @param submissions the API records.
 * @param names       what a nested shape leaves off: `{ modelName, teamName }`. A model's own
 *                    detail response nests its submissions without repeating whose they are —
 *                    see ModelSubmissionOut — and a row of one still has to say. Filled in
 *                    only where the record itself is silent, so a listing that carries them
 *                    keeps its own.
 */
function toSubmissionRows(submissions, { modelName = null, teamName = null } = {}) {
  return submissions.map((submission) => {
    const row = toSubmissionRow(submission);

    return {
      ...row,
      model_name: row.model_name ?? modelName,
      team_name: row.team_name ?? teamName,
    };
  });
}

// ─── FILTERS ─────────────────────────────────────────────────────────────────

const STATUSES = ["pending", "scoring", "done", "failed"];

const STATUS_OPTIONS = STATUSES.map((status) => ({
  value: status,
  label: status,
}));

// `rows` is unused: every option here is fixed by the schema rather than by what the
// rows happen to contain. Taken anyway, so all five filter builders share one shape.
function getSubmissionFilters(rows) {
  return [
    {
      type: "search",
      name: "label",
      placeholder: "Search by label...",
      match: matchIncludes("label"),
    },
    {
      type: "select",
      name: "suite",
      placeholder: "All suites",
      options: SUITE_OPTIONS,
      match: matchInArray("suites"),
    },
    {
      type: "select",
      name: "status",
      placeholder: "All statuses",
      options: STATUS_OPTIONS,
      match: matchEquals("status"),
    },
  ];
}

// ─── DISPLAY ─────────────────────────────────────────────────────────────────

function getSubmissionStatistics(submission) {
  const taskSubmissions = submission.task_submissions ?? [];

  return [
    ["tasks", taskSubmissions.length, getIcon("task")],
    ["task suites", suitesFromSubmission(submission).length, getIcon("suite")],
    // TODO PLACEHOLDER FOR NOW
    [
      "scored suites",
      suitesFromSubmission(submission).length,
      getIcon("score"),
    ],
  ];
}

function getSubmissionBadges(submission) {
  return [
    buildSuiteBadgeList(suitesFromSubmission(submission)),
    buildVisibleBadge(submission.is_public),
    buildStatusBadge(submission.status),
  ];
}

function getSubmissionSubtitle(submission) {
  return [
    { text: submission.model_name, icon: getIcon("model") },
    { text: submission.team_name, icon: getIcon("team") },
    {
      text: submission.created_at
        ? `Created ${formatDate(submission.created_at)}`
        : null,
      icon: getIcon("created"),
    },
  ].filter((entry) => entry.text);
}

export {
  getSubmissionBadges,
  getSubmissionFilters,
  getSubmissionStatistics,
  getSubmissionSubtitle,
  toSubmissionRows,
};
