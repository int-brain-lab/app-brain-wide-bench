import { loadSubmission } from "./submissionApi.js";
import { getTasks } from "../tasks/api.js";
import { renderTaskScoresTable } from "../tables/tasks.js";
import { renderMessage } from "../utils.js";


// ─── DOM ────────────────────────────────────────────────────────────────────

function taskScores() {
  return document.getElementById("task-scores");
}


// ─── RENDERING ──────────────────────────────────────────────────────────────

function renderHeader(submission, taskCount) {
  document.getElementById("page-description").textContent =
    `${submission.label} · ${submission.team_name} · ${taskCount} scored task${taskCount === 1 ? "" : "s"}`;
}

function renderBackLink(submission) {
  const link = document.getElementById("back-to-submission");

  link.textContent = `← Back to ${submission.label}`;
  link.href = `/html/submissions/submission_dashboard.html?id=${encodeURIComponent(submission.id)}`;
}


// ─── ENTRY POINT ────────────────────────────────────────────────────────────

async function loadSubmissionTaskScoresPage() {
  const submissionId = new URLSearchParams(location.search).get("id");

  if (!submissionId) {
    renderMessage(taskScores(), "No submission specified.", "error-msg");
    return;
  }

  // In parallel — the catalogue is a static lookup that doesn't depend on the
  // submission. It supplies the Metric column's *name*, which TaskScoreOut omits;
  // getTasks logs and returns [] on failure, degrading that column to "—".
  const [submission, tasks] = await Promise.all([loadSubmission(submissionId), getTasks()]);

  if (!submission) {
    renderMessage(taskScores(), "Could not load this submission.", "error-msg");
    return;
  }

  const taskCount = submission.task_submissions?.length ?? 0;

  renderHeader(submission, taskCount);
  renderBackLink(submission);

  if (taskCount === 0) {
    renderMessage(taskScores(), "This submission has no scored tasks yet.");
    return;
  }

  // `[submission]` because the table flattens a *list* of submissions into task rows;
  // here that list is one. showSubmission false for the same reason — the column and
  // its select would carry the same value on every row.
  renderTaskScoresTable({
    container: taskScores(),
    submissions: [submission],
    tasks,
    showSubmission: false,
  });
}

loadSubmissionTaskScoresPage();
