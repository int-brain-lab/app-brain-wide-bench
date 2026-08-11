// Dashboard scores
//
// A page showing a table of task scores for all submissions for all models for a user.
// The table allows you to search by model name and filter by suite or task name

import { loadAllScores } from "./dashboardApi.js";
import { renderTaskScoresTable } from "../scores/scoreTable.js";
import { showError, showMessage} from "../utils.js";
import { buildCount } from "../components/cards.js";


// ─── DOM ────────────────────────────────────────────────────────────────────

function getElements() {
  return {
    description: document.getElementById("page-description"),
    scores: document.getElementById("task-scores"),
    message: document.getElementById("task-scores")
  };
}

// ─── DATA ───────────────────────────────────────────────────────────────────

function countTaskSubmissions(submissions) {
  return submissions.reduce(
    (total, submission) => total + (submission.task_submissions?.length ?? 0),
    0
  );
}

// ─── RENDERING ──────────────────────────────────────────────────────────────

function renderHeader(elements, modelCount, scoredCount) {
  elements.description.textContent =
    `${buildCount(scoredCount, "tasks")} across ${buildCount(modelCount, "models")}`;
}

// ─── INITIALISATION ─────────────────────────────────────────────────────────

async function loadScoresPage() {
  const elements = getElements();

  try {
    const { models, submissions, tasks } = await loadAllScores();

    const taskCount = countTaskSubmissions(submissions);
    renderHeader(elements, models.length, taskCount);

    if (taskCount === 0) {
        showMessage(
        elements.message,
    "No task scores available. Please submit models to see scores here.",
      );
      return;
    }

    // Show both the model and submissions as columns
    renderTaskScoresTable({
      container: elements.scores,
      submissions,
      tasks,
      showModel: true,
      showSubmission: true,
    });

  } catch (error) {
    console.error(
      "Failed to load task scores:",
      error);

    showError(
      elements.message,
      "Could not load the task scores",
    )
  }
}

loadScoresPage();
