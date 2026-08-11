// Submission dashboard
//
// A dashboard for a single submission, showing its details, scores, and task submissions.


import {
  countTasks,
  scoresBySuite,
} from "../scores/scoreMaths.js";
import {
  scoreSorter,
  taskScoreColumns,
  toRows as toTaskScoreRows,
} from "../scores/scoreTable.js";
import { getTasks } from "../tasks/taskSubmissionApi.js";
import {
  taskSubmissionColumns,
  toRow as toTaskRow,
} from "../tasks/taskSubmissionTable.js";
import {
  suitesOf,
} from "../utils/score-cards.js";
import { renderDisplayFields } from "../utils/form-fields.js";
import { renderStaticTable } from "../utils/tables.js";
import { formatDate, showMessage, showError } from "../utils.js";
import { loadSubmission } from "./submissionApi.js";
import { loadSubmissionFields } from "./submissionSchema.js";
import {buildStatCards} from "../components/cards.js";

// ─── CONFIGURATION ──────────────────────────────────────────────────────────────

const SCORE_LIMIT = 5;

const SUBMISSION_PAGE_LINKS = {
  "submission-scores-link":
    "/html/submissions/submission_scores.html",
  "submission-details-link":
    "/html/submissions/submission_details.html",
  "submission-tasks-link":
    "/html/submissions/submission_tasks.html",
};

const SUMMARY_KEYS = [
  "label",
  "status",
  "is_public",
  "created_at",
  "updated_at",
];

// ─── DOM ────────────────────────────────────────────────────────────────────

function getElements() {
  return {
    message: document.getElementById("form-message"),
    title: document.getElementById("submission-title"),
    description: document.getElementById("submission-description"),
    stats: document.getElementById("submission-stats"),
    scores: document.getElementById("submission-scores"),
    details: document.getElementById("submission-details"),
    tasks: document.getElementById("submission-tasks"),
    links: Object.fromEntries(
      Object.keys(SUBMISSION_PAGE_LINKS).map(id => [
        id,
        document.getElementById(id),
      ]),
    ),
  };
}

// ─── DATA ───────────────────────────────────────────────────────────────────

function getStatistics(submission, taskSubmissions, taskCount) {

  return [
    [
      "tasks",
      taskSubmissions.length,
      "list-checks"],
    [
      "task suites",
      suitesOf(submission).length,
      "grid-3x3"],
    [
      "scored tasks",
      taskCount,
      "check-check"],
    [
      "visibility",
      submission.is_public ? "Public" : "Private",
      "globe",
    ],
  ];
}

function getDashboardData(submission) {
  const taskCount = countTasks(scoresBySuite([submission]));
  const taskSubmissions = submission.task_submissions ?? [];

  return {
    taskCount,
    taskSubmissions
  };
}

// ─── RENDERING ──────────────────────────────────────────────────────────────

function renderHeader(elements, submission) {
  elements.title.textContent = submission.label;

  elements.description.textContent = [
    submission.model_name,
    submission.team_name,
    submission.created_at
      ? `Created ${formatDate(submission.created_at)}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function renderStats(elements, statistics) {
  elements.stats.innerHTML = buildStatCards(statistics);
}

function renderTaskScores(elements, submission, knownTasks) {
  const rows = toTaskScoreRows([submission], knownTasks)
    .sort((a, b) =>
      scoreSorter(b.mean_score, a.mean_score),
    )
    .slice(0, SCORE_LIMIT);

  if (rows.length === 0) {
    showMessage(
      elements.scores,
      "No scores yet — this submission hasn't been scored.",
    );
    return;
  }

  elements.scores.innerHTML =
    renderStaticTable({
    columns: taskScoreColumns({ showSubmission: false }),
    rows,
  });
}

function renderDetails(elements, submission, fields) {
  const keys = SUMMARY_KEYS.filter(key => key in fields);
  const midpoint = Math.ceil(keys.length / 2);

  elements.details.innerHTML = `
    <div class="card row">
      <span class="column gap-md">
        ${renderDisplayFields(
          keys.slice(0, midpoint),
          submission,
          fields,
        )}
      </span>

      <span class="column gap-md">
        ${renderDisplayFields(
          keys.slice(midpoint),
          submission,
          fields,
        )}
      </span>
    </div>
  `;
}

function renderTaskSubmissions(elements, submission, taskSubmissions) {

  if (taskSubmissions.length === 0) {
    showMessage(
      elements.tasks,
      "This submission has no tasks.",
    );
    return;
  }

  elements.tasks.innerHTML = renderStaticTable({
    columns: taskSubmissionColumns(),
    rows: taskSubmissions.map(taskSubmission =>
      toTaskRow(submission, taskSubmission),
    ),
  });
}

function renderDashboard(
  elements,
  submission,
  fields,
  knownTasks,
  dashboardData
) {
  const {
    taskCount,
    taskSubmissions,
  } = dashboardData

  renderHeader(elements, submission);

  renderStats(
    elements,
    getStatistics(
      submission,
      taskSubmissions,
      taskCount
    )
);

  renderTaskScores(
    elements,
    submission,
    knownTasks);

  renderDetails(
    elements,
    submission,
    fields);

  renderTaskSubmissions(
    elements,
    submission,
    taskSubmissions);
}

// ─── EVENTS ─────────────────────────────────────────────────────────────────

function attachLinks(elements, submission) {
  for (const [id, page] of Object.entries(
    SUBMISSION_PAGE_LINKS,
  )) {
    const link = elements.links[id];

    if (!link) continue;

    link.href =
      `${page}?id=${encodeURIComponent(submission.id)}`;
  }
}

// ─── INITIALISATION ─────────────────────────────────────────────────────────

async function loadSubmissionDashboardPage() {
  const elements = getElements();

  try {
    const submissionId = new URLSearchParams(location.search).get("id");

    if (!submissionId) {
      showError(
        elements.message,
        "No submission id in the URL.",
      );
      return;
    }

    const [submission, fields, knownTasks] = await Promise.all([
      loadSubmission(submissionId),
      loadSubmissionFields(),
      getTasks(),
    ]);

    if (!submission) {
      showError(
        elements.message,
        `Could not load submission ${submissionId}.`,
      );
      return;
    }

    const dashboardData = getDashboardData(submission);

    renderDashboard(
      elements,
      submission,
      fields,
      knownTasks,
      dashboardData);

    attachLinks(elements, submission);

    globalThis.lucide?.createIcons?.();
  } catch (error) {
    console.error(
      "Failed to load submission dashboard:",
      error,
    );

    showError(
      elements.message,
      "Submission dashboard page could not be loaded",
    );
  }
}

loadSubmissionDashboardPage();
