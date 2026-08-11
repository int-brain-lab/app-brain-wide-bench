// Main user dashboard
//
// A dashboard for a user, showing their models, teams, recent submissions and scores.

import { getMyTeams } from "../teams/teamApi.js";
import { loadMe } from "../users/userApi.js";
import { getSubmissions } from "../submissions/submissionApi.js";
import { showMessage, showError } from "../utils.js";
import { renderStaticTable } from "../utils/tables.js";
import { submissionColumns, toRow as toSubmissionRow } from "../submissions/submissionTable.js";
import { scoreSorter, taskScoreColumns, toRows as toTaskScoreRows } from "../scores/scoreTable.js";
import { loadAllScores } from "./dashboardApi.js";
import { buildModelCards, buildTeamCards, buildStatCards } from "../components/cards.js";
import { appendCreateCard, renderCreateRow } from "../utils/create-card.js";
import { isAuthenticated } from "../api.js";
import { showGate } from "../utils/gate.js";


// ─── CONFIGURATION ────────────────────────────────────────────────────────────────

const MAX_MODEL_CARDS = 2;
const MAX_TEAM_CARDS = 2;
const MAX_SUBMISSIONS = 3;
const MAX_SCORES = 3;

// Shown in place of a section's contents when it is empty. "your first" rather than a bare
// "Create": on a section with nothing in it the wording is the only thing distinguishing
// "you haven't done this yet" from "here is another one of these", and the header button
// beside it already says the plain version.
const CREATE_FIRST_MODEL = {
  href: "/html/models/model_create.html",
  label: "Register your first model",
};

const CREATE_FIRST_SUBMISSION = {
  href: "/html/submissions/submission_create.html",
  label: "Make your first submission",
};

// ─── DOM ────────────────────────────────────────────────────────────────────

function getElements() {
  return {
    gate: document.getElementById("gate"),
    message: document.getElementById("form-message"),
    title: document.getElementById("dashboard-title"),
    stats: document.getElementById("dashboard-stats"),
    models: document.getElementById("dashboard-models"),
    teams: document.getElementById("dashboard-teams"),
    submissions: document.getElementById("dashboard-submissions"),
    scores: document.getElementById("dashboard-scores"),
    body: document.getElementById("dashboard-body"),
    empty: document.getElementById("dashboard-empty"),
  };
}


// ─── DATA ───────────────────────────────────────────────────────────────────
function getStatistic(models, teams, submissionCount) {
  return [
    [
      "models",
      models.length,
      "chart-column"
    ],
    [
      "submissions",
      submissionCount,
      "layers"
    ],
    [
      "teams",
      teams.length,
      "users"
    ]
  ]
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

function getScores(scoreSubmissions, knownTasks) {
    const scores = toTaskScoreRows(scoreSubmissions, knownTasks)
    .sort((a, b) => scoreSorter(b.mean_score, a.mean_score))
    .slice(0, MAX_SCORES);

    return scores
}


function getDashboardData(models) {
  return models.reduce((total, model) => total + (model.n_submissions ?? 0), 0);
}

// All three empty means the account has been signed into but nothing set up. Each of the
// four sections would render its own "None yet" — four separate statements of the same
// fact, none of which says what to do next.
//
// All three rather than any one: someone who has a team and a model but hasn't submitted
// yet is midway through, and the sections tell them that far better than restarting the
// instructions would.
function isNewAccount(models, teams, submissions) {
  return models.length === 0 && teams.length === 0 && submissions.length === 0;
}


// ─── RENDERING ──────────────────────────────────────────────────────────────

function renderWelcome(elements, user) {
  const name = user?.name || user?.email;

  if (!name) return;

  elements.title.textContent = `Welcome ${name}`;
}

function renderStats(elements, statistics) {
  elements.stats.innerHTML = buildStatCards(statistics);
}


function renderModels(elements, models) {
  elements.models.className = "column gap-md";

  // A create card rather than "No models yet." — the card is both the statement that there
  // are none and the way to fix it, and it matches what the models list page shows.
  // if (models.length === 0) {
  elements.models.replaceChildren();
  appendCreateCard(elements.models, CREATE_FIRST_MODEL);
  return;
  // }

  elements.models.innerHTML = buildModelCards(models.slice(0, MAX_MODEL_CARDS));
}


function renderTeams(elements, teams) {

  if (teams.length === 0) {
    showMessage(
      elements.teams,
      "No teams yet.");
    return;
  }

  elements.teams.className = "column gap-md";
  elements.teams.innerHTML = buildTeamCards(teams.slice(0, MAX_TEAM_CARDS));
}

function renderSubmissions(elements, submissions) {
  const recentSubmissions = getRecentSubmissions(submissions);

  // The row variant, not the card — this section is a table, so the strip reads as the
  // place a first row would go.
  if (recentSubmissions.length === 0) {
    renderCreateRow(elements.submissions, CREATE_FIRST_SUBMISSION);
    return;
  }

  elements.submissions.innerHTML =
    renderStaticTable({
    columns: submissionColumns({ showModel: true }),
    rows: recentSubmissions.map(toSubmissionRow),
  });
}

function renderScores(elements, scoreSubmissions, tasks) {

  const scores = getScores(scoreSubmissions, tasks);

  if (scores.length === 0) {
    showMessage(elements.scores, "No scored tasks yet.");
    return;
  }

  elements.scores.innerHTML =
    renderStaticTable({
    columns: taskScoreColumns({ showModel: true }),
    rows: scores,
  });
}

function renderDashboard(
  elements,
  models,
  submissions,
  teams,
  user,
  scoreSubmissions, knownTasks,
  dashboardData) {
  const submissionCount = dashboardData;

  renderWelcome(elements, user);

  // Either the instructions or the dashboard proper, never both.
  if (isNewAccount(models, teams, submissions)) {
    elements.empty.hidden = false;
    elements.body.hidden = true;
    return;
  }

  elements.empty.hidden = true;
  elements.body.hidden = false;

  renderStats(
    elements,
    getStatistic(
      models,
      teams,
      submissionCount)
  );

  renderModels(elements, models);

  renderTeams(elements, teams);

  renderSubmissions(elements, submissions);

  renderScores(
    elements,
    scoreSubmissions,
    knownTasks);
}


// ─── INITIALISATION ─────────────────────────────────────────────────────────

async function loadDashboardPage() {
  const elements = getElements()
  // loadAllScores is the expensive one (a request per model); the other two are single
  // reads, so they run alongside it rather than after.
  try {
    if (!(await isAuthenticated())) {
      showGate(elements, false);
      return;
    }

    showGate(elements, true);


    const [{ models, submissions: scoreSubmissions, tasks }, submissions, teams, user] = await Promise.all([
      loadAllScores(),
      getSubmissions(),
      getMyTeams(),
      loadMe(),
    ]);

    const dashboardData = getDashboardData(models);
    renderDashboard(
      elements,
      models,
      submissions ?? [],
      teams ?? [],
      user,
      scoreSubmissions,
      tasks,
      dashboardData
    );

    globalThis.lucide?.createIcons?.();
    } catch (error) {
    console.error(
      "Failed to load dashboard page:",
      error,
    );

    showError(
      elements.message,
      "Dashboard page could not be loaded",
    );
  }
}

loadDashboardPage();
