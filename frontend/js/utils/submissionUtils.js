import {
  buildStatusBadge,
  buildSuiteBadgeList,
  buildVisibleBadge,
} from "../components/badges.js";
import { getIcon } from "../components/icons.js";
import { suitesFromSubmission } from "../core/suites.js";
import { formatDate } from "../core/utils.js";
import {
  matchEquals,
  matchInArray,
  matchIncludes,
  SUITE_OPTIONS,
} from "../components/filters.js";

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
    suites: suitesFromSubmission(submission),
  };
}

export function toSubmissionRows(submissions) {
  return submissions.map(toSubmissionRow);
}

// ─── FILTERS ─────────────────────────────────────────────────────────────────

const STATUSES = ["pending", "scoring", "done", "failed"];

const STATUS_OPTIONS = STATUSES.map((status) => ({
  value: status,
  label: status,
}));

export function getSubmissionFilters() {
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

export function getSubmissionStatistics(submission) {
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

// What the submission is, at a glance: which suites it covers, how far scoring has got,
// and whether anyone can read it. The suites come from the tasks it carries, the same way
// the tables derive them.
export function getSubmissionBadges(submission) {
  return [
    buildSuiteBadgeList(suitesFromSubmission(submission)),
    buildVisibleBadge(submission.is_public),
    buildStatusBadge(submission.status),
  ];
}

export function getSubmissionSubtitle(submission) {
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
