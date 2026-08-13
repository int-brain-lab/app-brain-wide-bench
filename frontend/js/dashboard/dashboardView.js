// User dashboard record page — the record is the signed-in user, so there is no `?id=`.
//
// Two views: the overview, and every task score across every model.

import { getMyTeams } from "../teams/teamApi.js";
import { loadMe } from "../users/userApi.js";
import { getSubmissions } from "../submissions/submissionApi.js";
import { showMessage } from "../utils.js";
import { renderStaticTable } from "../utils/tables.js";
import { submissionColumns, toRow as toSubmissionRow } from "../submissions/submissionTable.js";
import {
  renderTaskScoresTable,
  scoreSorter,
  taskScoreColumns,
  toRows as toTaskScoreRows,
} from "../scores/scoreTable.js";
import { loadAllScores } from "./dashboardApi.js";
import { buildCount, buildModelCards, buildStatCards, buildTeamCards } from "../components/cards.js";
import { appendCreateCard, renderCreateRow } from "../utils/create-card.js";
import { loadRecordPage } from "../pages/record-loader.js";
import {
  buildBody,
  buildHeader,
  buildMessage,
  buildPage,
  buildSections,
  buildStats,
  pageMessage,
  renderHeader,
  renderPage,
  sectionBody,
} from "../pages/record-page.js";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

const MAX_MODEL_CARDS = 2;
const MAX_TEAM_CARDS = 2;
const MAX_SUBMISSIONS = 3;
const MAX_SCORES = 3;

const DESCRIPTION = "Your models, submissions and results.";

// "your first" rather than a bare "Create": on a section with nothing in it the wording is
// the only thing distinguishing "you haven't done this yet" from "here is another one", and
// the header button beside it already says the plain version.
const CREATE_FIRST_MODEL = {
  href: "/html/models/model_create.html",
  label: "Register your first model",
};

const CREATE_FIRST_SUBMISSION = {
  href: "/html/submissions/submission_create.html",
  label: "Make your first submission",
};

const TEAM_SECTIONS = [
  {
    id: "teams",
    title: "Teams",
    links: [
      { href: "/html/teams/team_list.html", label: "View all", icon: "users" },
      {
        href: "/html/teams/team_create.html",
        label: "Create team",
        icon: "plus",
        className: "primary-inv",
      },
    ],
  },
  {
    id: "models",
    title: "Models",
    links: [
      { href: "/html/models/model_list.html", label: "View all", icon: "chart-column" },
      {
        href: "/html/models/model_create.html",
        label: "Create model",
        icon: "plus",
        className: "primary-inv",
      },
    ],
  },
];

const BOTTOM_SECTIONS = [
  {
    id: "submissions",
    title: "Recent submissions",
    links: [
      { href: "/html/submissions/submission_list.html", label: "View all", icon: "layers" },
      {
        href: "/html/submissions/submission_create.html",
        label: "Create submission",
        icon: "plus",
        className: "primary-inv",
      },
    ],
  },
  {
    id: "scores",
    title: "Task scores",
    view: "scores",
    linkIcon: "book-open",
    linkText: "View all scores",
  },
];

const BACK = {
  text: "← Back to dashboard",
  view: "dashboard",
};

// ─── DATA ────────────────────────────────────────────────────────────────────

function getStatistics(models, teams, submissionCount) {
  return [
    ["models", models.length, "chart-column"],
    ["submissions", submissionCount, "layers"],
    ["teams", teams.length, "users"],
  ];
}

function getRecentSubmissions(submissions) {
  return [...submissions]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, MAX_SUBMISSIONS);
}

function getTopScores(scoreSubmissions, knownTasks) {
  return toTaskScoreRows(scoreSubmissions, knownTasks)
    .sort((a, b) => scoreSorter(b.mean_score, a.mean_score))
    .slice(0, MAX_SCORES);
}

function countSubmissions(models) {
  return models.reduce((total, model) => total + (model.n_submissions ?? 0), 0);
}

function countTaskSubmissions(scoreSubmissions) {
  return scoreSubmissions.reduce(
    (total, submission) => total + (submission.task_submissions?.length ?? 0),
    0,
  );
}

// All three empty means the account has been signed into but nothing set up. All three
// rather than any one: someone with a team and a model but no submission yet is midway
// through, and the sections tell them that far better than restarting the instructions.
function isNewAccount(models, teams, submissions) {
  return !models.length && !teams.length && !submissions.length;
}

// ─── UTILS ───────────────────────────────────────────────────────────────────

function getWelcome(user) {
  const name = user?.name || user?.email;

  return name ? `Welcome ${name}` : "Welcome";
}

// ─── SECTIONS ────────────────────────────────────────────────────────────────

function renderTeamsSection(teams) {
  const container = sectionBody("teams");

  if (!teams.length) {
    showMessage(container, "No teams yet.");
    return;
  }

  container.className = "column gap-md";
  container.innerHTML = buildTeamCards(teams.slice(0, MAX_TEAM_CARDS));
}

function renderModelsSection(models) {
  const container = sectionBody("models");

  container.className = "column gap-md";

  // A create card rather than "No models yet." — the card is both the statement that there
  // are none and the way to fix it, and it matches what the models list page shows.
  if (!models.length) {
    container.replaceChildren();
    appendCreateCard(container, CREATE_FIRST_MODEL);
    return;
  }

  container.innerHTML = buildModelCards(models.slice(0, MAX_MODEL_CARDS));
}

function renderSubmissionsSection(submissions) {
  const recentSubmissions = getRecentSubmissions(submissions);
  const container = sectionBody("submissions");

  // The row variant, not the card — this section is a table, so the strip reads as the
  // place a first row would go.
  if (!recentSubmissions.length) {
    renderCreateRow(container, CREATE_FIRST_SUBMISSION);
    return;
  }

  container.innerHTML = renderStaticTable({
    columns: submissionColumns({ showModel: true }),
    rows: recentSubmissions.map(toSubmissionRow),
  });
}

function renderScoresSection(scoreSubmissions, knownTasks) {
  const scores = getTopScores(scoreSubmissions, knownTasks);
  const container = sectionBody("scores");

  if (!scores.length) {
    showMessage(container, "No scored tasks yet.");
    return;
  }

  container.innerHTML = renderStaticTable({
    columns: taskScoreColumns({ showModel: true }),
    rows: scores,
  });
}

// ─── VIEWS ───────────────────────────────────────────────────────────────────

function renderGettingStarted(user) {
  renderPage(buildPage({ header: buildHeader(), body: buildBody() }));

  renderHeader(getWelcome(user), DESCRIPTION);

  sectionBody("body").replaceChildren(
    document.getElementById("dashboard-empty").content.cloneNode(true),
  );
}

function renderDashboardView({ user, models, teams, submissions, scoreSubmissions, knownTasks }) {
  if (isNewAccount(models, teams, submissions)) {
    renderGettingStarted(user);
    return;
  }

  renderPage(
    buildPage({
      header: buildHeader(),
      body:
        buildStats("grid-3") +
        // Teams and Models side by side: both are short card lists, and a full-width row of
        // each would push everything below off the fold. `align-start` so the shorter of the
        // two sits at the top rather than being stretched by .page-section's space-between.
        `<div class="grid-2 align-start">${buildSections(TEAM_SECTIONS)}</div>` +
        buildSections(BOTTOM_SECTIONS),
    }),
  );

  renderHeader(getWelcome(user), DESCRIPTION);

  sectionBody("stats").innerHTML = buildStatCards(
    getStatistics(models, teams, countSubmissions(models)),
  );

  renderTeamsSection(teams);
  renderModelsSection(models);
  renderSubmissionsSection(submissions);
  renderScoresSection(scoreSubmissions, knownTasks);
}

function renderScoresView({ models, scoreSubmissions, knownTasks }) {
  renderPage(
    buildPage({
      back: BACK,
      header: buildHeader(),
      body: buildMessage() + buildBody(),
    }),
  );

  const taskCount = countTaskSubmissions(scoreSubmissions);

  renderHeader(
    "Task scores",
    `${buildCount(taskCount, "tasks")} across ${buildCount(models.length, "models")}`,
  );

  if (!taskCount) {
    showMessage(
      pageMessage(),
      "No task scores available. Please submit models to see scores here.",
    );
    return;
  }

  return renderTaskScoresTable({
    container: sectionBody("body"),
    submissions: scoreSubmissions,
    tasks: knownTasks,
    showModel: true,
    showSubmission: true,
  });
}

// ─── LOAD ────────────────────────────────────────────────────────────────────

const VIEWS = {
  dashboard: renderDashboardView,
  scores: renderScoresView,
};

loadRecordPage({
  views: VIEWS,
  noun: "dashboard",
  requiresId: false,

  // loadAllScores is the expensive one — a request per model — so the other three run
  // alongside it rather than after.
  load: async () => {
    const [{ models, submissions: scoreSubmissions, tasks }, submissions, teams, user] =
      await Promise.all([loadAllScores(), getSubmissions(), getMyTeams(), loadMe()]);

    return {
      user,
      models,
      teams: teams ?? [],
      submissions: submissions ?? [],
      scoreSubmissions,
      knownTasks: tasks,
    };
  },
});
