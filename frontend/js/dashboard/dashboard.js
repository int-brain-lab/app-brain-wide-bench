

// Page entry for dashboard.html — one screen covering everything the caller owns:
// counts, a few models, their most recent submissions, and the best task scores.
//
// Every section is a preview with a "view all" out to the page that owns it, so the
// dashboard never becomes the place you do the actual work.

import { getMyTeams } from "../teams/teamApi.js";
import { loadMe } from "../users/api.js";
import { getSubmissions } from "../submissions/submissionApi.js";
import { escapeHtml, formatDate, renderMessage } from "../utils.js";
import { buildStatCards, buildSuiteCoverageBadges } from "../utils/score-cards.js";
import { renderStaticTable } from "../tables/utils.js";
import { submissionColumns, toRow as toSubmissionRow } from "../tables/submissions.js";
import { scoreSorter, taskScoreColumns, toRows as toTaskScoreRows } from "../tables/tasks.js";
import { loadAllScores } from "./dashboardApi.js";


// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const MAX_MODEL_CARDS = 3;
const MAX_TEAM_CARDS = 3;
const MAX_SUBMISSIONS = 5;
const MAX_SCORES = 5;


// ─── HEADER ─────────────────────────────────────────────────────────────────

// Falls back to the static "Welcome" already in the markup rather than printing
// "Welcome undefined" — loadMe returns undefined if the request fails.
function renderWelcome(user) {
  const name = user?.name || user?.email;

  if (!name) return;

  document.getElementById("dashboard-title").textContent = `Welcome ${name}`;
}


// ─── STATS ──────────────────────────────────────────────────────────────────

// Submissions are summed from each model's `n_submissions` rather than counted from the
// submissions list: that field is already visibility-scoped server-side, and a
// submission belongs to exactly one model, so the sum is the total without a second
// source of truth.
function renderStats(models, submissions, teams) {
  const submissionCount = models.reduce((total, model) => total + (model.n_submissions ?? 0), 0);

  document.getElementById("dashboard-stats").innerHTML = buildStatCards([
    ["models", models.length, "chart-column"],
    ["submissions", submissionCount || submissions.length, "layers"],
    ["teams", teams.length, "users"],
  ]);
}


// ─── MODELS ─────────────────────────────────────────────────────────────────

// Cards rather than a table: at three rows a table is mostly header, and these are the
// same cards the models list shows.
function buildModelCards(models) {
  return models.map(model => `
    <a class="card column left gap-sm" href="/html/models/model_dashboard.html?id=${encodeURIComponent(model.id)}">
      <div class="column left">
        <p class="title">${escapeHtml(model.name)}</p>
        <p class="metadata">${escapeHtml(model.team_name || "—")}</p>
      </div>
      <div class="row left gap-md">
        ${buildSuiteCoverageBadges(model.task_suites ?? [])}
      </div>
      <p class="metadata">${model.n_submissions ?? 0} submission${(model.n_submissions ?? 0) === 1 ? "" : "s"} · Created ${escapeHtml(formatDate(model.created_at))}</p>
    </a>
  `).join("");
}

function renderModels(models) {
  const container = document.getElementById("dashboard-models");

  if (models.length === 0) {
    renderMessage(container, "No models yet.");
    return;
  }

  // One per row: the section is half the page wide now, so cards stack rather than
  // sitting three abreast.
  container.className = "column gap-md";
  container.innerHTML = buildModelCards(models.slice(0, MAX_MODEL_CARDS));
}


// ─── TEAMS ──────────────────────────────────────────────────────────────────

// The same card the teams list renders, minus its "Member" badge — every team here is
// one the caller belongs to, so the badge would be on every card.
function buildTeamCards(teams) {
  return teams.map(team => `
    <a class="card column left gap-sm" href="/html/teams/team_dashboard.html?id=${encodeURIComponent(team.id)}">
      <p class="title">${escapeHtml(team.name)}</p>
    </a>
  `).join("");
}

function renderTeams(teams) {
  const container = document.getElementById("dashboard-teams");

  if (teams.length === 0) {
    renderMessage(container, "No teams yet.");
    return;
  }

  container.className = "column gap-md";
  container.innerHTML = buildTeamCards(teams.slice(0, MAX_TEAM_CARDS));
}


// ─── SUBMISSIONS ────────────────────────────────────────────────────────────

// From GET /api/submissions rather than the flattened model details: it already spans
// every model, and it's the one list carrying `updated_at`, which is what "recent"
// sorts on. showModel, since this crosses models.
function renderSubmissions(submissions) {
  const container = document.getElementById("dashboard-submissions");

  if (submissions.length === 0) {
    renderMessage(container, "No submissions yet.");
    return;
  }

  const recent = submissions
    .slice()
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0, MAX_SUBMISSIONS);

  container.innerHTML = renderStaticTable({
    columns: submissionColumns(true),
    rows: recent.map(toSubmissionRow),
  });
}


// ─── TASK SCORES ────────────────────────────────────────────────────────────

// Best-scoring tasks across everything, so the preview answers "how is my work doing"
// rather than "what did I touch last". Unscored tasks sort last and so fall off the
// end, which is the right trade for a top-N.
function renderScores(scoreSubmissions, tasks) {
  const container = document.getElementById("dashboard-scores");

  const rows = toTaskScoreRows(scoreSubmissions, tasks)
    .sort((a, b) => scoreSorter(b.mean_score, a.mean_score))
    .slice(0, MAX_SCORES);

  if (rows.length === 0) {
    renderMessage(container, "No scored tasks yet.");
    return;
  }

  container.innerHTML = renderStaticTable({
    columns: taskScoreColumns({ showModel: true }),
    rows,
  });
}


// ─── INITIALISATION ─────────────────────────────────────────────────────────

async function loadDashboardPage() {
  // loadAllScores is the expensive one (a request per model); the other two are single
  // reads, so they run alongside it rather than after.
  const [{ models, submissions: scoreSubmissions, tasks }, submissions, teams, user] = await Promise.all([
    loadAllScores(),
    getSubmissions(),
    getMyTeams(),
    loadMe(),
  ]);

  renderWelcome(user);
  renderStats(models, submissions ?? [], teams ?? []);
  renderModels(models);
  renderTeams(teams ?? []);
  renderSubmissions(submissions ?? []);
  renderScores(scoreSubmissions, tasks);

  globalThis.lucide?.createIcons?.();
}

loadDashboardPage();
