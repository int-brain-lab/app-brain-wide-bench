
import { countTasks, scoresBySuite } from "../scores.js";
import { loadSubmission } from "./submissionApi.js";
import { loadSubmissionFields } from "./submissionSchema.js";
import { getTasks } from "../tasks/api.js";
import {formatDate, renderMessage} from "../utils.js";
import {buildStatCards, suitesOf} from "../utils/score-cards.js";
import {scoreSorter, taskScoreColumns, toRows as toTaskScoreRows} from "../tables/tasks.js";
import {renderStaticTable} from "../tables/utils.js";
import {renderDisplayFields} from "../utils/form-fields.js";
import {taskSubmissionColumns, toRow as toTaskRow} from "../tables/taskSubmissions.js";


// ─── RENDERING ──────────────────────────────────────────────────────────────


// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const SCORE_LIMIT = 5;

const SUBMISSION_PAGE_LINKS = {
  "submission-scores-link": "/html/submissions/submission_scores.html",
  "submission-details-link": "/html/submissions/submission_details.html",
  "submission-tasks-link": "/html/submissions/submission_tasks.html",
};

const SUMMARY_KEYS = ["label", "status", "is_public", "created_at", "updated_at"];

// ─── HELPERS ────────────────────────────────────────────────────────────────
function getStatistics(submission, scoredTaskCount) {
  const taskSubmissions = submission.task_submissions ?? [];

  return [
    ["tasks", taskSubmissions.length, "list-checks"],
    ["task suites", suitesOf(submission).length, "grid-3x3"],
    ["scored tasks", scoredTaskCount, "check-check"],
    ["visibility", submission.is_public ? "Public" : "Private", "globe"],
  ];
}

function showMessage(message, className = "info-msg") {
  const container = document.getElementById("form-message");

  if (!message) {
    container.hidden = true;
    container.replaceChildren();
    return;
  }

  renderMessage(container, message, className);
}

// ─── RENDERING ──────────────────────────────────────────────────────────────

function renderSubmissionHeader(submission) {
  document.getElementById("submission-title").textContent = submission.label ?? "Submission";
  document.getElementById("submission-description").textContent =
    [
      submission.model_name,
      submission.team_name,
      submission.created_at ? `Created ${formatDate(submission.created_at)}` : null,
    ].filter(Boolean).join(" · ");
}

function renderStats(statistics) {
  document.getElementById("submission-stats").innerHTML = buildStatCards(statistics);
}

function renderTaskScores(submission, tasks) {
  const container = document.getElementById("submission-scores");

  const rows = toTaskScoreRows([submission], tasks)
    .sort((a, b) => scoreSorter(b.mean_score, a.mean_score))
    .slice(0, SCORE_LIMIT);

  if (rows.length === 0) {
    renderMessage(container, "No scores yet — this submission hasn't been scored.");
    return;
  }

  container.innerHTML = renderStaticTable({
    columns: taskScoreColumns({ showSubmission: false }),
    rows,
  });
}


function renderSubmissionSummary(submission, fields) {
  const keys = SUMMARY_KEYS.filter(key => key in fields);
  const half = Math.ceil(keys.length / 2);

  document.getElementById("submission-details").innerHTML = `
    <div class="card row">
      <span class="column gap-md">
        ${renderDisplayFields(keys.slice(0, half), submission, fields)}
      </span>
      <span class="column gap-md">
        ${renderDisplayFields(keys.slice(half), submission, fields)}
      </span>
    </div>
  `;
}


function renderTaskSubmissions(submission) {
  const container = document.getElementById("submission-tasks");
  const taskSubmissions = submission.task_submissions ?? [];

  if (taskSubmissions.length === 0) {
    renderMessage(container, "This submission has no tasks.");
    return;
  }

  container.innerHTML = renderStaticTable({
    columns: taskSubmissionColumns(),
    rows: taskSubmissions.map(taskSubmission => toTaskRow(submission, taskSubmission)),
  });
}



// ─── EVENTS ─────────────────────────────────────────────────────────────────
function attachLinks(submission) {
  for (const [id, page] of Object.entries(SUBMISSION_PAGE_LINKS)) {
    const link = document.getElementById(id);
    if (!link) continue;

    link.href = `${page}?id=${encodeURIComponent(submission.id)}`;
  }
}

// ─── INITIALISATION ─────────────────────────────────────────────────────────

async function loadSubmissionDashboardPage() {
  try {

    const submissionId = new URLSearchParams(location.search).get("id");

    if (!submissionId) {
      showMessage("No submission id in the URL.", "error-msg");
      return;
    }

    const submission = await loadSubmission(submissionId);

    if (!submission) {
      showMessage("Could not load this submission.", "error-msg");
    }

    const fields = await loadSubmissionFields();
    const tasks = await getTasks();

    const suiteScores = scoresBySuite([submission]);

    renderSubmissionHeader(submission);
    renderStats(getStatistics(submission), countTasks(suiteScores));
    renderTaskScores(submission, tasks);
    renderSubmissionSummary(submission, fields);
    renderTaskSubmissions(submission);

    attachLinks(submission);

    globalThis.lucide?.createIcons?.();

    } catch (err) {
      console.error(err);
      showMessage("Could not load this submission.", "error-msg");
    }
}

loadSubmissionDashboardPage();
