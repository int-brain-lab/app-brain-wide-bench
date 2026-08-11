// Model dashboard
//
// A dashboard for a single model, showing its details, scores, and recent submissions.

import { loadModel } from "./modelApi.js";
import { loadModelFields } from "./modelSchema.js";
import { suiteFromTask } from "../utils/suites.js";
import { formatDate, showMessage, showError, mean} from "../utils.js";
import {
  buildSuiteScoreBars
} from "../components/bars.js"
import { renderStaticTable } from "../utils/tables.js";
import {
  submissionColumns,
  toRow as toSubmissionRow,
} from "../submissions/submissionTable.js";
import { renderDisplayFields } from "../utils/form-fields.js";
import { buildStatCards } from "../components/cards.js";
import { renderCreateRow } from "../utils/create-card.js";
import { isAuthenticated } from "../api.js";
import { showGate } from "../utils/gate.js";


// ─── CONFIGURATION ──────────────────────────────────────────────────────────

const MAX_SUBMISSIONS = 3;

// `?model=` so the form arrives with this model already chosen; submissionCreate.js
// validates the id against the caller's own models before honouring it.
function createSubmissionLink(model) {
  return {
    href: `/html/submissions/submission_create.html?model=${encodeURIComponent(model.id)}`,
    label: "New submission for this model",
  };
}

const MODEL_PAGE_LINKS = {
  "edit-model-link":
    "/html/models/model_details.html",
  "model-scores-link": "/html/models/model_scores.html",
  "model-details-link": "/html/models/model_details.html",
  "model-submissions-link": "/html/models/model_submissions.html",
};

// Which of those land the target already editing. Only Edit does; the rest are
// read-only views, and `&edit` on them would open a form the page doesn't want.
const EDIT_ON_ARRIVAL = new Set(["edit-model-link"]);

// These are currently supplied by the leaderboard/ranking logic.
// Keep them separate from the rendering so they can later be replaced by
// values returned by the API.
const RANKS = {
  ts1: 1,
  ts2: 3,
  ts3: 8,
  overall: 3,
};

// ─── DOM ────────────────────────────────────────────────────────────────────

function getElements() {
  return {
    gate: document.getElementById("gate"),
    message: document.getElementById("form-message"),
    title: document.getElementById("model-title"),
    description: document.getElementById("model-description"),
    stats: document.getElementById("model-stats"),
    scores: document.getElementById("model-scores"),
    details: document.getElementById("model-details"),
    submissions: document.getElementById("model-submissions"),
    submissionsCreate: document.getElementById("model-submissions-create"),
    links: Object.fromEntries(
      Object.keys(MODEL_PAGE_LINKS).map(id => [
        id,
        document.getElementById(id),
      ]),
    ),
  };
}

// ─── DATA ───────────────────────────────────────────────────────────────────

function getStatistics(submissions, meanScores, taskCount) {
  return [
    [
      "submissions",
      submissions.length,
      "layers",
    ],
    [
      "public submissions",
      submissions.filter(
        submission => submission.is_public,
      ).length,
      "globe",
    ],
    [
      "task suites",
      Object.keys(meanScores).length - 1,
      "grid-3x3",
    ],
    [
      "tasks",
      taskCount,
      "list-checks",
    ],
  ];
}

function getRecentSubmissions(submissions) {
  return submissions
    .slice()
    .sort(
      (a, b) =>
        new Date(b.updated_at) -
        new Date(a.updated_at),
    )
    .slice(0, MAX_SUBMISSIONS);
}

function getDashboardData(model) {
  const submissions = model.submissions ?? [];
  const suiteScores = scoresBySuite(submissions);

  const meanScores = getMeanScores(suiteScores);
  const taskCount = countTasks(suiteScores);

  return {
    submissions,
    meanScores,
    taskCount,
    ranks: RANKS,
  };
}

// TODO THIS IS INCORRECT WE DON"T WANT JUST THE LATEST SUBMISSION WE WANT THE LATEST FOR EACH TASK
function latestSubmission(submissions) {
  return submissions.reduce((latest, submission) => {
    if (!latest) return submission;

    return Date.parse(submission.created_at ?? 0) > Date.parse(latest.created_at ?? 0)
      ? submission
      : latest;
  }, null);
}

function scoresBySuite(submissions) {
  const latest = latestSubmission(submissions ?? []);
  const scores = {};

  for (const { task_id, score } of latest?.task_submissions ?? []) {
    const value = score?.primary_metric_mean;
    const suite = suiteFromTask(task_id);

    // An id naming no known suite is skipped rather than bucketed. Without this it would
    // key the result under the string "null" and show up as a fourth suite downstream.
    if (value == null || suite === null) continue;

    (scores[suite] ??= {})[task_id] = value;
  }

  return scores;
}


function getMeanScores(suiteScores) {
  const means = Object.fromEntries(
    Object.entries(suiteScores).map(([suite, tasks]) => [suite, mean(Object.values(tasks))]),
  );

  means.overall = mean(Object.values(means).filter(value => value != null));

  return means;
}

// Total number of scored tasks across every suite.
function countTasks(suiteScores) {
  return Object.values(suiteScores).reduce((total, tasks) => total + Object.keys(tasks).length, 0);
}



// ─── RENDERING ──────────────────────────────────────────────────────────────

function renderHeader(elements, model) {
  elements.title.textContent = model.name;

  elements.description.textContent = [
    model.team_name,
    model.created_at
      ? `Created ${formatDate(model.created_at)}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function renderStats(elements, statistics) {
  elements.stats.innerHTML =
    buildStatCards(statistics);
}

function renderScores(elements, meanScores, ranks) {
  elements.scores.innerHTML =
    buildSuiteScoreBars(meanScores, ranks);
}

function renderDetails(elements, model, fields) {
  const columns = [
    ["team_name", "temporal_context_s"],
    ["created_at", "link_code"],
  ];

  elements.details.innerHTML = `
    <div class="card row">
      ${columns
        .map(
          fieldNames => `
            <span class="column gap-md">
              ${renderDisplayFields(
                fieldNames,
                model,
                fields,
              )}
            </span>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderSubmissions(elements, model, submissions) {
  const recentSubmissions = getRecentSubmissions(submissions);

  if (recentSubmissions.length === 0) {
    showMessage(
      elements.submissions,
      "This model has no submissions.",
    );
  } else {
    elements.submissions.innerHTML =
      renderStaticTable({
        columns: submissionColumns(),
        rows: recentSubmissions.map(toSubmissionRow),
      });
  }

  // Below the table either way — a model with nothing submitted yet is exactly when this
  // is worth offering, so it isn't inside the branch above.
  renderCreateRow(elements.submissionsCreate, createSubmissionLink(model));
}

function renderDashboard(
  elements,
  model,
  fields,
  dashboardData,
) {
  const {
    submissions,
    meanScores,
    taskCount,
    ranks,
  } = dashboardData;

  renderHeader(elements, model);

  renderStats(
    elements,
    getStatistics(
      submissions,
      meanScores,
      taskCount,
    ),
  );

  renderScores(
    elements,
    meanScores,
    ranks,
  );

  renderDetails(
    elements,
    model,
    fields,
  );

  renderSubmissions(elements, model, submissions);
}

// ─── EVENTS ─────────────────────────────────────────────────────────────────

function attachLinks(elements, model) {
  for (const [id, page] of Object.entries(
    MODEL_PAGE_LINKS,
  )) {
    const link = elements.links[id];

    if (!link) continue;

    link.href =
      `${page}?id=${encodeURIComponent(model.id)}`
      + (EDIT_ON_ARRIVAL.has(id) ? "&edit" : "");
  }
}

// ─── INITIALISATION ─────────────────────────────────────────────────────────

async function loadModelDashboardPage() {
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

    const [model, fields] = await Promise.all([
      loadModel(modelId),
      loadModelFields(),
    ]);

    if (!model) {
      showError(
        elements.message,
        `Could not load model ${modelId}.`,
      );
      return;
    }

    const dashboardData = getDashboardData(model);

    renderDashboard(
      elements,
      model,
      fields,
      dashboardData,
    );

    attachLinks(elements, model);

    globalThis.lucide?.createIcons?.();
  } catch (error) {
    console.error(
      "Failed to load model dashboard:",
      error,
    );

    showError(
      elements.message,
      "Model dashboard page could not be loaded.",
    );
  }
}

loadModelDashboardPage();
