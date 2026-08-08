import { loadSubmission } from "./submissionApi.js";
import { loadTaskFields } from "../tasks/schema.js";
import { renderTaskSubmissionsTable } from "../tables/taskSubmissions.js";
import { renderMessage } from "../utils.js";


// ─── DOM ────────────────────────────────────────────────────────────────────

function taskSubmissions() {
  return document.getElementById("task-submissions");
}


// ─── RENDERING ──────────────────────────────────────────────────────────────

function renderHeader(submission, taskCount) {
  document.getElementById("page-description").textContent =
    `${submission.label} · ${submission.team_name} · ${taskCount} task${taskCount === 1 ? "" : "s"}`;
}

function renderBackLink(submission) {
  const link = document.getElementById("back-to-submission");

  link.textContent = `← Back to ${submission.label}`;
  link.href = `/html/submissions/submission_dashboard.html?id=${encodeURIComponent(submission.id)}`;
}


// ─── ENTRY POINT ────────────────────────────────────────────────────────────

async function loadSubmissionTasksPage() {
  const submissionId = new URLSearchParams(location.search).get("id");

  if (!submissionId) {
    renderMessage(taskSubmissions(), "No submission specified.", "error-msg");
    return;
  }

  // loadTaskFields in parallel: the columns take their headings from TASK_FIELDS, and
  // while the labels are static, awaiting it here keeps this page from racing the
  // schema's option fetch if a column ever needs those.
  const [submission] = await Promise.all([loadSubmission(submissionId), loadTaskFields()]);

  if (!submission) {
    renderMessage(taskSubmissions(), "Could not load this submission.", "error-msg");
    return;
  }

  const taskCount = submission.task_submissions?.length ?? 0;

  renderHeader(submission, taskCount);
  renderBackLink(submission);

  if (taskCount === 0) {
    renderMessage(taskSubmissions(), "This submission has no tasks.");
    return;
  }

  renderTaskSubmissionsTable({
    container: taskSubmissions(),
    submission,
  });
}

loadSubmissionTasksPage();
