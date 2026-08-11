// Model dashboard
//
// A dashboard for a single model, showing its details, scores, and recent submissions.

import { loadModel } from "./modelApi.js";
import { loadModelFields } from "./modelSchema.js";
import {
  countTasks,
  getMeanScores,
  scoresBySuite,
} from "../scores/scoreMaths.js";
import { formatDate, showMessage, showError } from "../utils.js";
import {
  buildSuiteScoreBars,
} from "../utils/score-cards.js";
import { renderStaticTable } from "../utils/tables.js";
import {
  submissionColumns,
  toRow as toSubmissionRow,
} from "../submissions/submissionTable.js";
import { renderDisplayFields } from "../utils/form-fields.js";
import { buildStatCards } from "../components/cards.js";

// ─── CONFIGURATION ──────────────────────────────────────────────────────────

const MAX_SUBMISSIONS = 3;

const MODEL_PAGE_LINKS = {
  "model-scores-link": "/html/models/model_scores.html",
  "model-details-link": "/html/models/model_details.html",
  "model-submissions-link": "/html/models/model_submissions.html",
};

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
    message: document.getElementById("form-message"),
    title: document.getElementById("model-title"),
    description: document.getElementById("model-description"),
    stats: document.getElementById("model-stats"),
    scores: document.getElementById("model-scores"),
    details: document.getElementById("model-details"),
    submissions: document.getElementById("model-submissions"),
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

function renderSubmissions(elements, submissions) {
  const recentSubmissions = getRecentSubmissions(submissions);

  if (recentSubmissions.length === 0) {
    showMessage(
      elements.submissions,
      "This model has no submissions.",
    );
    return;
  }

  elements.submissions.innerHTML =
    renderStaticTable({
      columns: submissionColumns(),
      rows: recentSubmissions.map(toSubmissionRow),
    });
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

  renderSubmissions(elements, submissions);
}

// ─── EVENTS ─────────────────────────────────────────────────────────────────

function attachLinks(elements, model) {
  for (const [id, page] of Object.entries(
    MODEL_PAGE_LINKS,
  )) {
    const link = elements.links[id];

    if (!link) continue;

    link.href =
      `${page}?id=${encodeURIComponent(model.id)}`;
  }
}

// ─── INITIALISATION ─────────────────────────────────────────────────────────

async function loadModelDashboardPage() {
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
