// Page entry for html/dashboard/dashboard_scores.html — every task score across every model and submission
// the caller can see, filterable by model, submission, suite and task name.
//
// The dashboard's score preview is the top five of exactly this table; this is where it
// links to.

import { loadAllScores } from "./dashboardApi.js";
import { renderTaskScoresTable } from "../tables/tasks.js";
import { renderMessage } from "../utils.js";


// ─── DOM ────────────────────────────────────────────────────────────────────

function taskScores() {
  return document.getElementById("task-scores");
}


// ─── RENDERING ──────────────────────────────────────────────────────────────

function renderHeader(modelCount, scoredCount) {
  document.getElementById("page-description").textContent =
    `${scoredCount} task${scoredCount === 1 ? "" : "s"} across ${modelCount} model${modelCount === 1 ? "" : "s"}`;
}


// ─── ENTRY POINT ────────────────────────────────────────────────────────────

function countTaskSubmissions(submissions) {
  return submissions.reduce(
    (total, submission) => total + (submission.task_submissions?.length ?? 0),
    0
  );
}

async function loadScoresPage() {
  const { models, submissions, tasks } = await loadAllScores();

  const taskCount = countTaskSubmissions(submissions);

  renderHeader(models.length, taskCount);

  if (taskCount === 0) {
    renderMessage(taskScores(), "No tasks yet.");
    return;
  }

  // Both dimensions on: this is the one table that spans models *and* submissions, so
  // those columns and their selects are the whole point of the page.
  renderTaskScoresTable({
    container: taskScores(),
    submissions,
    tasks,
    showModel: true,
    showSubmission: true,
  });
}

loadScoresPage();
