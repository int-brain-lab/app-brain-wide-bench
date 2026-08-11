// Model scores
//
// A page showing a table of task scores for all submissions of a model.
// The table allows you to search by submission name and filter by suite or task name

import { loadModel } from "./modelApi.js";
import { getTasks } from "../tasks/taskSubmissionApi.js";
import { renderTaskScoresTable } from "../scores/scoreTable.js";
import { showError, showMessage } from "../utils.js";
import { buildCount} from "../components/cards.js";
import { isAuthenticated } from "../api.js";
import { showGate } from "../utils/gate.js";

// ─── DOM ────────────────────────────────────────────────────────────────────

function getElements() {
  return {
    gate: document.getElementById("gate"),
    description: document.getElementById("page-description"),
    backLink: document.getElementById("back-to-model"),
    scores: document.getElementById("task-scores"),
    message: document.getElementById("task-scores")
  };
}

// ─── DATA ───────────────────────────────────────────────────────────────────

function countTaskSubmissions(submissions) {
  return submissions.reduce(
    (total, submission) =>
      total + (submission.task_submissions?.length ?? 0),
    0,
  );
}

function getModelData(model) {
  const submissions = model.submissions ?? [];

  return {
    submissions,
    taskCount: countTaskSubmissions(submissions),
  };
}

// ─── RENDERING ──────────────────────────────────────────────────────────────

function renderHeader(elements, model, taskCount) {
  elements.description.textContent = [
    model.name,
    model.team_name,
    buildCount(taskCount, 'scored task')
    ]
    .filter(Boolean)
    .join(" · ");
}

function renderBackLink(elements, model) {
  elements.backLink.textContent = `← Back to ${model.name}`;
  elements.backLink.href =
    `/html/models/model_dashboard.html?id=${encodeURIComponent(model.id)}`;
}

// ─── INITIALISATION ─────────────────────────────────────────────────────────

async function loadModelTaskScoresPage() {
  const elements = getElements();

  try {
    if (!(await isAuthenticated())) {
      showGate(elements, false);
      return;
    }

    showGate(elements, true);


    const modelId = new URLSearchParams(location.search).get("id");

    if (!modelId) {
      showError(
        elements.message,
        "No model id in the URL.",
      );
      return;
    }

    const [model, knownTasks] = await Promise.all([
      loadModel(modelId),
      getTasks(),
    ]);

    if (!model) {
      showError(
        elements.message,
        "Could not load this model.",
      );
      return;
    }

    const {
      submissions,
      taskCount,
    } = getModelData(model);

    renderHeader(elements, model, taskCount);

    renderBackLink(elements, model);

    if (taskCount === 0) {
      showMessage(
        elements.message,
        "This model has no scored tasks yet.",
      );
      return;
    }

    // Show the submissions column but not the models column
    renderTaskScoresTable({
      container: elements.scores,
      submissions,
      tasks: knownTasks,
      showModel: false,
      showSubmission: true,
    });
  } catch (error) {
    console.error(
      "Failed to load model task scores:",
      error,
    );

    showError(
      elements.message,
      "Could not load the task scores.",
    );
  }
}

loadModelTaskScoresPage();


