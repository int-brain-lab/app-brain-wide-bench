// Submission tasks
//
// A page showing a table of task submissions for a single submission
// The table allows you to search by task name and select by suite

import { loadSubmission } from "./submissionApi.js";
import { renderTaskSubmissionsTable } from "../tasks/taskSubmissionTable.js";
import {showError, showMessage} from "../utils.js";
import {buildCount} from "../components/cards.js";
import { isAuthenticated } from "../api.js";
import { showGate } from "../utils/gate.js";

// ─── DOM ────────────────────────────────────────────────────────────────────

function getElements() {
  return {
    gate: document.getElementById("gate"),
    description: document.getElementById("page-description"),
    backLink: document.getElementById("back-to-submission"),
    table: document.getElementById("task-submissions"),
    message: document.getElementById("task-submissions")
  };
}

// ─── RENDERING ──────────────────────────────────────────────────────────────

function renderHeader(elements, submission, taskCount) {
  elements.description.textContent = [
    submission.label,
    submission.team_name,
    buildCount(taskCount, 'task')
    ]
    .filter(Boolean)
    .join(" · ");
}

function renderBackLink(elements, submission) {
  elements.backLink.textContent = `← Back to ${submission.label}`;
  elements.backLink.href =
    `/html/submissions/submission_dashboard.html?id=${encodeURIComponent(submission.id)}`;
}

// ─── INITIALISATION ─────────────────────────────────────────────────────────

async function loadSubmissionTasksPage() {
  const elements = getElements();
  try {
    if (!(await isAuthenticated())) {
      showGate(elements, false);
      return;
    }

    showGate(elements, true);


    const submissionId = new URLSearchParams(location.search).get("id");

    if (!submissionId) {
        showError(
          elements.message,
          "No submission id in the URL.",
        );
        return;
      }

    const submission = await loadSubmission(submissionId)

    if (!submission) {
      showError(
        elements.message,
        "Could not load this submission.",
        );
      return;
    }

    const taskCount = submission.task_submissions?.length ?? 0;

    renderHeader(elements, submission, taskCount);
    renderBackLink(elements, submission);

    if (taskCount === 0) {
      showMessage(
        elements.message,
        "This submission has no tasks yet.");
      return;
    }

    renderTaskSubmissionsTable({
      container: elements.table,
      submission,
    });
  } catch (error) {
  console.error(
    "Failed to load submission tasks:",
    error);

  showError(
    elements.message,
    "Could not load the submission tasks",
  );
  }
}

loadSubmissionTasksPage();