// User dashboard record page — the record is the signed-in user, so there is no `?id=`.
//
// Two views: the overview, and every task score across every model.

import { getMyTeams } from "../api/teamApi.js";
import { getIcon } from "../components/icons.js";
import { loadMe } from "../api/userApi.js";
import { getMySubmissions } from "../api/submissionApi.js";
import { getMyModels } from "../api/modelApi.js";
import { getMyTaskSubmissions} from "../api/taskSubmissionApi.js";
import { showEmpty } from "../core/utils.js";
import { renderStaticSubmissionsTable } from "../tables/submissionTable.js";
import {
  renderStaticTaskScoresTable,
  renderTaskScoresTable,
  toScoreResultRows,
} from "../tables/scoreTable.js";
import { buildCount } from "../components/count.js";
import { buildModelCards } from "../cards/modelCards.js";
import { buildStatCards } from "../cards/statCards.js";
import { buildTeamCards } from "../cards/teamCards.js";
import { appendCreateCard, renderCreateRow } from "../cards/createCard.js";
import { loadRecordPage } from "../templates/record-loader.js";
import {
  buildBody,
  buildHeader,
  buildPage,
  buildSections,
  buildStats,
  renderHeader,
  renderPage,
  sectionBody,
} from "../templates/record-page.js";


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
      { href: "/html/teams/team_list.html", label: "View all", icon: getIcon("team") },
      {
        href: "/html/teams/team_create.html",
        label: "Create team",
        icon: getIcon("add"),
        className: "primary-inv",
      },
    ],
  },
  {
    id: "models",
    title: "Models",
    links: [
      { href: "/html/models/model_list.html", label: "View all", icon: getIcon("model") },
      {
        href: "/html/models/model_create.html",
        label: "Create model",
        icon: getIcon("add"),
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
      { href: "/html/submissions/submission_list.html", label: "View all", icon: getIcon("submission") },
      {
        href: "/html/submissions/submission_create.html",
        label: "Create submission",
        icon: getIcon("add"),
        className: "primary-inv",
      },
    ],
  },
  {
    id: "scores",
    title: "Task scores",
    view: "scores",
    linkIcon: getIcon("details"),
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
    ["models", models.length, getIcon("model")],
    ["submissions", submissionCount, getIcon("submission")],
    ["teams", teams.length, getIcon("team")],
  ];
}

function countSubmissions(models) {
  return models.reduce((total, model) => total + (model.n_submissions ?? 0), 0);
}

function countTaskSubmissions(scoreRows) {
  return scoreRows.length;
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
    showEmpty(container, "No teams yet.");
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
  const container = sectionBody("submissions");

  // The row variant, not the card — this section is a table, so the strip reads as the
  // place a first row would go.
  if (!submissions.length) {
    renderCreateRow(container, CREATE_FIRST_SUBMISSION);
    return;
  }

  renderStaticSubmissionsTable({
    container,
    submissions,
    showModel: true,
    limit: MAX_SUBMISSIONS,
  });
}

function renderScoresSection(scoreRows) {
  const container = sectionBody("scores");

  if (!scoreRows.length) {
    showEmpty(container, "No scored tasks yet.");
    return;
  }

  renderStaticTaskScoresTable({
    container,
    rows: scoreRows,
    showModel: true,
    limit: MAX_SCORES,
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

function renderDashboardView({ user, models, teams, submissions, scoreRows }) {
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
  renderScoresSection(scoreRows);
}

function renderScoresView({ models, scoreRows }) {
  renderPage(
    buildPage({
      back: BACK,
      header: buildHeader(),
      body: buildBody(),
    }),
  );

  const taskCount = countTaskSubmissions(scoreRows);

  renderHeader(
    "Task scores",
    `${buildCount(taskCount, "task")} across ${buildCount(models.length, "model")}`,
  );

  if (!taskCount) {
    showEmpty(sectionBody("body"), "No scored tasks yet.");
    return;
  }

  return renderTaskScoresTable({
    container: sectionBody("body"),
    rows: scoreRows,
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

  // Score rows are built once here, not per view — both views render the same rows, and
  // the scores view is reached without a reload.
  load: async () => {
    const [ models, taskSubmissions, submissions, teams, user] =
      await Promise.all([getMyModels(), getMyTaskSubmissions(), getMySubmissions(), getMyTeams(), loadMe()]);

    return {
      user,
      models,
      teams: teams ?? [],
      submissions: submissions ?? [],
      scoreRows: toScoreResultRows(taskSubmissions),
    };
  },
});
