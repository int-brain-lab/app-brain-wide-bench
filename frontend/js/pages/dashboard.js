// User dashboard record page — the record is the signed-in user, so there is no `?id=`.
//
// Two views: the overview, and every task score across every model.

import { renderHtml } from "../core/render.js";
import { getMyModels } from "../api/modelApi.js";
import { getMySubmissions } from "../api/submissionApi.js";
import { getMyTaskSubmissions } from "../api/taskSubmissionApi.js";
import { getMyTeams } from "../api/teamApi.js";
import { loadMe } from "../api/userApi.js";
import { loadTaskFields } from "../schemas/taskSubmissionSchema.js";
import { toModelRows } from "../utils/modelUtils.js";
import { toSubmissionRows } from "../utils/submissionUtils.js";
import {
  getTaskScoreFilters,
  toScoreResultRows,
} from "../utils/taskScoreUtils.js";
import { toTeamRows } from "../utils/teamUtils.js";
import {
  getUserStatistics,
  getWelcome,
  isNewAccount,
} from "../utils/userUtils.js";
import { buildStaticModelsTable } from "../tables/modelTable.js";
import { buildStaticSubmissionsTable } from "../tables/submissionTable.js";
import {
  buildStaticTaskScoresTable,
  createTaskScoresTable,
} from "../tables/taskScoreTable.js";
import { buildStaticTeamsTable } from "../tables/teamTable.js";
import { SCORE_MODES } from "../comparisons/scoreModes.js";
import { buildCreateCard } from "../cards/createCard.js";
import { buildStatCards } from "../cards/statCards.js";
import { buildCreateButton } from "../components/buttons.js";
import { buildCount } from "../components/count.js";
import {
  buildHeader,
  buildPage,
  buildSection,
  buildSections,
  getSection,
  getSectionBody,
} from "../components/sections.js";
import { loadRecordPage } from "../templates/recordPage.js";
import { renderRecordListView } from "../templates/recordList.js";
import { renderHeader, renderPage } from "../templates/pageChrome.js";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

const MAX_TEAMS = 2;
const MAX_MODELS = 2;
const MAX_SUBMISSIONS = 3;
const MAX_SCORES = 3;

const DESCRIPTION = "Your models, submissions and results.";

const BACK = {
  text: "← Back to dashboard",
  view: "dashboard",
};

// The render functions are declarations, so they are defined by the time this is read.
const VIEWS = {
  dashboard: renderDashboardView,
  scores: renderScoresView,
};

// The three create affordances, in the page header. Each carries its own id because
// buildCreateButton's default would give all three the same one.
//
// `card` is the same offer worded for the card a section with nothing in it shows in place
// of its table.
const CREATE_TEAM = {
  id: "create-team",
  href: "/html/teams/team_create.html",
  label: "New team",
  card: "Create your first team",
};

const CREATE_MODEL = {
  id: "create-model",
  href: "/html/models/model_create.html",
  label: "New model",
  card: "Create your first model",
};

const CREATE_SUBMISSION = {
  id: "create-submission",
  href: "/html/submissions/submission_create.html",
  label: "New submission",
  card: "Create your first submission",
};

const DASHBOARD_SECTIONS = [
  {
    id: "stats",
    className: "stats-grid",
  },
  {
    sections: [
      {
        id: "teams",
        title: "Teams",
      },
      {
        id: "models",
        title: "Models",
      },
    ],
  },
  {
    id: "submissions",
    title: "Submissions",
  },
  {
    id: "scores",
    title: "Task scores",
  },
];

// ─── LINKS ───────────────────────────────────────────────────────────────────

// Each list page is named once: the section heading's create button and the table footer's
// "View all" both point at one, and a second copy of a path is how they stop agreeing.
const TEAMS_LIST_HREF = "/html/teams/team_list.html";
const MODELS_LIST_HREF = "/html/models/model_list.html";
const SUBMISSIONS_LIST_HREF = "/html/submissions/submission_list.html";

// ─── DASHBOARD ───────────────────────────────────────────────────────────────

// A section with nothing in it says what it is for, in the words of the thing that would
// fill it.
function renderCreateCard(container, create) {
  renderHtml(
    container,
    buildCreateCard({ href: create.href, label: create.card }),
    { refresh: true },
  );
}

function renderStatsSection(statistics) {
  renderHtml(getSectionBody("stats"), buildStatCards(statistics));
}

function renderTeamsSection(teams) {
  const container = getSectionBody("teams");

  if (!teams.length) {
    renderCreateCard(container, CREATE_TEAM);
    return;
  }

  renderHtml(
    container,
    buildStaticTeamsTable({
      rows: toTeamRows(teams),
      limit: MAX_TEAMS,
      viewAll: { href: TEAMS_LIST_HREF },
    }),
  );
}

function renderModelsSection(models) {
  const container = getSectionBody("models");

  if (!models.length) {
    renderCreateCard(container, CREATE_MODEL);
    return;
  }

  renderHtml(
    container,
    buildStaticModelsTable({
      rows: toModelRows(models),
      limit: MAX_MODELS,
      viewAll: { href: MODELS_LIST_HREF },
    }),
  );
}

function renderSubmissionsSection(submissions) {
  const container = getSectionBody("submissions");

  if (!submissions.length) {
    renderCreateCard(container, CREATE_SUBMISSION);
    return;
  }

  renderHtml(
    container,
    buildStaticSubmissionsTable({
      rows: toSubmissionRows(submissions),
      showModel: true,
      limit: MAX_SUBMISSIONS,
      viewAll: { href: SUBMISSIONS_LIST_HREF },
    }),
  );
}

function renderScoresSection(scoreRows) {
  if (!scoreRows.length) {
    getSection("scores").hidden = true;
    return;
  }

  renderHtml(
    getSectionBody("scores"),
    buildStaticTaskScoresTable({
      rows: scoreRows,
      showModel: true,
      limit: MAX_SCORES,
      viewAll: { view: "scores" },
    }),
  );
}

function renderGettingStarted(user) {
  renderPage(
    buildPage({
      header: buildHeader(),
      body: buildSection({ id: "getting-started" }),
    }),
  );

  renderHeader(getWelcome(user), DESCRIPTION);

  getSectionBody("getting-started").replaceChildren(
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
      header: buildHeader([
        buildCreateButton(CREATE_TEAM),
        buildCreateButton(CREATE_MODEL),
        buildCreateButton(CREATE_SUBMISSION),
      ]),
      body: buildSections(DASHBOARD_SECTIONS),
    }),
  );

  renderHeader(getWelcome(user), DESCRIPTION);

  renderStatsSection(getUserStatistics(models, teams));

  renderTeamsSection(teams);
  renderModelsSection(models);
  renderSubmissionsSection(submissions);
  renderScoresSection(scoreRows);
}

// ─── SCORES VIEW ─────────────────────────────────────────────────────────────

function renderScoresView({ models, scoreRows }) {
  const display = { showModel: true, showSubmission: true, showMethodology: true };

  return renderRecordListView({
    noun: "score",
    back: BACK,
    renderTitle: () =>
      renderHeader(
        "Task scores",
        `${buildCount(scoreRows.length, "task")} across ${buildCount(models.length, "model")}`,
      ),
    empty: "No scored tasks yet.",

    rows: scoreRows,

    createTable: ({ rows, selection }) =>
      createTaskScoresTable({
        ...display,
        rows,
        selection,
        showFilters: false,
      }),

    filterControls: (rows) => getTaskScoreFilters(rows, display),

    modes: SCORE_MODES,
  });
}

// ─── LOAD ────────────────────────────────────────────────────────────────────

loadRecordPage({
  views: VIEWS,

  noun: "dashboard",
  requiresId: false,

  // Score rows are built once here, not per view — both views render the same rows, and
  // the scores view is reached without a reload.
  load: async () => {
    // `loadTaskFields` fills the methodology fields' options in place from the server's own
    // enums, which is where the score filters read them from. Caught rather than allowed to
    // reject: a failing /api/meta then costs those filters their options rather than the
    // page its panels.
    const [models, taskSubmissions, submissions, teams, user] =
      await Promise.all([
        getMyModels(),
        getMyTaskSubmissions(),
        getMySubmissions(),
        getMyTeams(),
        loadMe(),
        loadTaskFields().catch(() => undefined),
      ]);

    return {
      user,
      models,
      teams: teams ?? [],
      submissions: submissions ?? [],
      scoreRows: toScoreResultRows(taskSubmissions),
    };
  },
});
