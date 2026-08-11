// Model submissions
//
// A page showing a table of submissions for a model.
// The table allows you to search by submission name and filter by suite or submission status

import { loadModel } from "./modelApi.js";
import { renderSubmissionsTable } from "../submissions/submissionTable.js";
import { showError, showMessage } from "../utils.js";

// ─── DOM ────────────────────────────────────────────────────────────────────

function getElements() {
  return {
    description: document.getElementById("page-description"),
    backLink: document.getElementById("back-to-model"),
    submissions: document.getElementById("submissions-list"),
    message: document.getElementById("submissions-list"),
  };
}

// ─── RENDERING ──────────────────────────────────────────────────────────────

function renderHeader(elements, model, submissionCount) {
  elements.description.textContent =
    `${model.name} · ${model.team_name} · ` +
    `${submissionCount} submission${submissionCount === 1 ? "" : "s"}`;
}

function renderBackLink(elements, model) {
  elements.backLink.textContent =
    `← Back to ${model.name}`;

  elements.backLink.href =
    `/html/models/model_dashboard.html?id=${encodeURIComponent(model.id)}`;
}

// ─── INITIALISATION ─────────────────────────────────────────────────────────

async function loadModelSubmissionsPage() {
  const elements = getElements();
  try {

    const modelId = new URLSearchParams(location.search).get("id");

    if (!modelId) {
      showError(
        elements.message,
        "No model id in the URL.",
      );
      return;
    }

    const model = await loadModel(modelId);

    if (!model) {
      showError(
        elements.message,
        "Could not load this model.",
      );
      return;
    }

    const submissions = model.submissions ?? [];

    renderHeader(
      elements,
      model,
      submissions.length,
    );

    renderBackLink(elements, model);

    if (submissions.length === 0) {
      showMessage(
        elements.message,
        "This model has no submissions yet.",
      );
      return;
    }

    renderSubmissionsTable({
      container: elements.submissions,
      submissions});
  } catch (error) {
    console.error(
      "Failed to load model submissions:",
      error,
    );

    showError(
      elements.message,
      "Could not load the submissions for this model.",
    );
  }
}

loadModelSubmissionsPage();

