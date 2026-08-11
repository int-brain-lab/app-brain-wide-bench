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


// ─── CONFIGURATION ────────────────────────────────────────────────────────────────

const MAX_MODEL_CARDS = 3;
const MAX_TEAM_CARDS = 3;
const MAX_SUBMISSIONS = 5;
const MAX_SCORES = 5;

// ─── DOM ────────────────────────────────────────────────────────────────────

function getElements() {
  return {
    message: document.getElementById("form-message"),
    title: document.getElementById("dashboard-title"),
    stats: document.getElementById("dashboard-stats"),
    models: document.getElementById("dashboard-models"),
    teams: document.getElementById("dashboard-teams"),
    submissions: document.getElementById("dashboard-submissions"),
    scores: document.getElementById("dashboard-scores"), }; }


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

  if (models.length === 0) {
    showMessage(
      elements.models,
      "No models yet.");
    return;
  }

  elements.models.className = "column gap-md";
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

  if (recentSubmissions.length === 0) {
    showMessage(
      elements.submissions,
      "No submissions yet.");
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
