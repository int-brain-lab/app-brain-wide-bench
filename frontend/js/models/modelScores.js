import { loadModel } from "./modelApi.js";
import { getTasks } from "../tasks/api.js";
import { renderTaskScoresTable } from "../tables/tasks.js";
import { renderMessage } from "../utils.js";


// ─── DOM ────────────────────────────────────────────────────────────────────

function taskScores() {
  return document.getElementById("task-scores");
}


// ─── RENDERING ──────────────────────────────────────────────────────────────

function renderHeader(model, taskCount) {
  document.getElementById("page-description").textContent =
    `${model.name} · ${model.team_name} · ${taskCount} scored task${taskCount === 1 ? "" : "s"}`;
}

function renderBackLink(model) {
  const link = document.getElementById("back-to-model");

  link.textContent = `← Back to ${model.name}`;
  link.href = `/html/models/model_dashboard.html?id=${encodeURIComponent(model.id)}`;
}


// ─── ENTRY POINT ────────────────────────────────────────────────────────────

function countTaskSubmissions(submissions) {
  return submissions.reduce(
    (total, submission) => total + (submission.task_submissions?.length ?? 0),
    0
  );
}

async function loadModelTaskScoresPage() {
  const modelId = new URLSearchParams(location.search).get("id");

  if (!modelId) {
    renderMessage(taskScores(), "No model specified.", "error-msg");
    return;
  }

  const [model, tasks] = await Promise.all([loadModel(modelId), getTasks()]);

  if (!model) {
    renderMessage(taskScores(), "Could not load this model.", "error-msg");
    return;
  }

  const submissions = model.submissions ?? [];
  const taskCount = countTaskSubmissions(submissions);

  renderHeader(model, taskCount);
  renderBackLink(model);

  if (taskCount === 0) {
    renderMessage(taskScores(), "This model has no scored tasks yet.");
    return;
  }

  renderTaskScoresTable({
    container: taskScores(),
    submissions,
    tasks,
  });
}

loadModelTaskScoresPage();
