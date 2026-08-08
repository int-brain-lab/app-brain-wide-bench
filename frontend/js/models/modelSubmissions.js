import { loadModel } from "./modelApi.js";
import { renderSubmissionsTable } from "../tables/submissions.js";
import { renderMessage } from "../utils.js";


// ─── DOM ────────────────────────────────────────────────────────────────────

function submissionsList() {
  return document.getElementById("submissions-list");
}


// ─── RENDERING ──────────────────────────────────────────────────────────────

function renderHeader(model, submissionCount) {
  document.getElementById("page-description").textContent =
    `${model.name} · ${model.team_name} · ${submissionCount} submission${submissionCount === 1 ? "" : "s"}`;
}

function renderBackLink(model) {
  const link = document.getElementById("back-to-model");

  link.textContent = `← Back to ${model.name}`;
  link.href = `/html/models/model_dashboard.html?id=${encodeURIComponent(model.id)}`;
}


// ─── ENTRY POINT ────────────────────────────────────────────────────────────

async function loadModelSubmissionsPage() {
  const modelId = new URLSearchParams(location.search).get("id");

  if (!modelId) {
    renderMessage(submissionsList(), "No model specified.", "error-msg");
    return;
  }

  const model = await loadModel(modelId);

  if (!model) {
    renderMessage(submissionsList(), "Could not load the submissions for this model.", "error-msg");
    return;
  }

  const submissions = model.submissions ?? [];

  renderHeader(model, submissions.length);
  renderBackLink(model);

  if (submissions.length === 0) {
    renderMessage(submissionsList(), "This model has no submissions yet.");
    return;
  }

  renderSubmissionsTable({
    container: submissionsList(),
    submissions,
  });
}

loadModelSubmissionsPage();
