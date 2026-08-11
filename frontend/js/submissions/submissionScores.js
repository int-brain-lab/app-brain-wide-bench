// Submission scores
//
// A page showing a table of task scores for a single submission
// The table allows you to search by task name and select by suite

import { loadSubmission } from "./submissionApi.js";
import { getTasks } from "../tasks/taskSubmissionApi.js";
import { renderTaskScoresTable } from "../scores/scoreTable.js";
import { showError, showMessage } from "../utils.js";
import { buildCount } from "../components/cards.js";
import { isAuthenticated } from "../api.js";
import { showGate } from "../utils/gate.js";


// ─── DOM ────────────────────────────────────────────────────────────────────

function getElements() {
  return {
    gate: document.getElementById("gate"),
    description: document.getElementById("page-description"),
    backLink: document.getElementById("back-to-submission"),
    scores: document.getElementById("task-scores"),
    message: document.getElementById("task-scores")
  };
}

// ─── RENDERING ──────────────────────────────────────────────────────────────

function renderHeader(elements, submission, taskCount) {
  elements.description.textContent = [
    submission.label,
    submission.team_name,
    buildCount(taskCount, 'scored task')
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

async function loadSubmissionTaskScoresPage() {
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

    const [submission, knownTasks] = await Promise.all([
      loadSubmission(submissionId),
      getTasks()]);

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
        "This submission has no scored tasks yet.");
      return;
    }

    // Do not show the model nor submission as columns in the table
    renderTaskScoresTable({
      container: elements.scores,
      submissions: [submission],
      tasks: knownTasks,
      showModel: false,
      showSubmission: false,
    });
  } catch (error) {
  console.error(
    "Failed to load submission task scores:",
    error);

  showError(
    elements.message,
    "Could not load the submission task scores",
  );
  }
}

loadSubmissionTaskScoresPage();
