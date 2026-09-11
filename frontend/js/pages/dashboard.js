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
  getSuiteBadges,
  getTaskScoreFilters,
  toBestScoreRows,
  toScoreResultRows,
} from "../utils/taskScoreUtils.js";
import { toTeamRows } from "../utils/teamUtils.js";
import { getUserSubtitle, getWelcome, isNewAccount } from "../utils/userUtils.js";
import { dateSorter } from "../tables/formatters.js";
import { buildBestScoresTable, createTaskScoresTable } from "../tables/taskScoreTable.js";
import { previewRows } from "../tables/table.js";
import { SCORE_PANEL } from "../comparisons/taskScoreComparison.js";
import { buildCreateCard } from "../cards/createCard.js";
import { buildModelCards } from "../cards/modelCards.js";
import { buildSubmissionCards } from "../cards/submissionCards.js";
import { buildTeamCards } from "../cards/teamCards.js";
import { buildCount } from "../components/count.js";
import { buildViewAllButton } from "../components/buttons.js";
import {
  buildHeader,
  buildPage,
  buildSection,
  buildSectionFooter,
  buildSections,
  getSection,
  getSectionBody,
} from "../components/sections.js";
import { loadRecordPage } from "../templates/recordPage.js";
import { renderRecordListView } from "../templates/recordList.js";
import { renderHeader, renderPage } from "../templates/pageChrome.js";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

// The same for all three: they sit side by side, and a row of lists of different lengths
// reads as one of them having run out.
const MAX_CARDS = 2;

// The render functions are declarations, so they are defined by the time this is read.
const VIEWS = {
  dashboard: renderDashboardView,
  scores: renderScoresView,
};

// ─── LINKS ───────────────────────────────────────────────────────────────────

// Each list page is named once: the section heading's create button and its "View all" both
// point at one, and a second copy of a path is how they stop agreeing.
const TEAMS_LIST_HREF = "/html/teams/team_list.html";
const MODELS_LIST_HREF = "/html/models/model_list.html";
const SUBMISSIONS_LIST_HREF = "/html/submissions/submission_list.html";

// What a section with nothing in it offers in place of its cards.
const CREATE_TEAM = {
  href: "/html/teams/team_create.html",
  card: "Create your first team",
};

const CREATE_MODEL = {
  href: "/html/models/model_create.html",
  card: "Create your first model",
};

const CREATE_SUBMISSION = {
  href: "/html/submissions/submission_create.html",
  card: "Create your first submission",
};

// The way from each section's preview to the whole of it, by the id of the section it
// closes. Under the content rather than beside the heading — see buildSectionFooter.
const VIEW_ALL = {
  teams: { noun: "team", href: TEAMS_LIST_HREF },
  models: { noun: "model", href: MODELS_LIST_HREF },
  submissions: { noun: "submission", href: SUBMISSIONS_LIST_HREF },
  scores: { noun: "score", view: "scores" },
};

// What the account has achieved first, the lists it navigates by second — and the figures
// beside the results rather than over the whole page, as the record dashboards set them.
const DASHBOARD_SECTIONS = [
  {
    // Equal columns: all three hold the same card, so none of them earns more room. What
    // the account holds is said once in the page's own header, not in cards over these.
    sections: [
      { id: "teams", title: "Teams" },
      { id: "models", title: "Models" },
      { id: "submissions", title: "Submissions" },
    ],
  },
  {
    id: "scores",
    title: "Your best scores",
    description:
      "The best you have scored on each task, across every model and submission of yours.",
  },
];

// ─── DASHBOARD ───────────────────────────────────────────────────────────────

// A section with nothing in it says what it is for, in the words of the thing that would
// fill it.
function renderCreateCard(container, create) {
  renderHtml(container, buildCreateCard({ href: create.href, label: create.card }), {
    refresh: true,
  });
}

// The way from a section's preview to the whole of it, under the content — see
// buildSectionFooter. Built at render rather than beside the sections above, because the
// number it names is data.
//
// `showing` is a section already holding every one the button would open — "View all 2 teams"
// under the two of them. Kept as spacing rather than dropped: the stacks beside it size their
// cards by the row their own buttons take, and one without that row draws taller cards.
function buildFooter(id, count, { showing = false } = {}) {
  const { noun, ...target } = VIEW_ALL[id];

  return buildSectionFooter(buildViewAllButton(noun, target, { count }), { hidden: showing });
}

// What the section shows, with the way to the rest of it underneath. Only for a section
// that has something: the create card an empty one shows is already the way on from there.
function renderSection(id, content, count) {
  renderHtml(getSectionBody(id), content + buildFooter(id, count), {
    refresh: true,
  });
}

// Stacked in what the section is given, every card the same size — see `.card-stack`.
//
// The footer goes inside the stack rather than after it, so it takes the row under the last
// card: a stack of one puts its empty half below the button rather than above it.
function renderCards(id, cards, count) {
  const footer = buildFooter(id, count, { showing: count <= MAX_CARDS });

  renderHtml(getSectionBody(id), `<div class="card-stack">${cards}${footer}</div>`, {
    refresh: true,
  });
}

function renderTeamsSection(teams) {
  if (!teams.length) {
    renderCreateCard(getSectionBody("teams"), CREATE_TEAM);
    return;
  }

  renderCards("teams", buildTeamCards(toTeamRows(teams).slice(0, MAX_CARDS)), teams.length);
}

function renderModelsSection(models) {
  if (!models.length) {
    renderCreateCard(getSectionBody("models"), CREATE_MODEL);
    return;
  }

  // Newest first, as the list behind the "view all" orders them.
  const recent = previewRows(
    toModelRows(models),
    (a, b) => dateSorter(b.created_at, a.created_at),
    MAX_CARDS,
  );

  renderCards("models", buildModelCards(recent), models.length);
}

function renderSubmissionsSection(submissions) {
  if (!submissions.length) {
    renderCreateCard(getSectionBody("submissions"), CREATE_SUBMISSION);
    return;
  }

  const recent = previewRows(
    toSubmissionRows(submissions),
    (a, b) => dateSorter(b.updated_at, a.updated_at),
    MAX_CARDS,
  );

  renderCards("submissions", buildSubmissionCards(recent), submissions.length);
}

function renderScoresSection(scoreRows) {
  const best = toBestScoreRows(scoreRows);

  if (!best.length) {
    getSection("scores").hidden = true;
    return;
  }

  // Every one of them, not a preview: there is one row per task the account has scored, so
  // at most as many as the benchmark has tasks. The link is the way to the rest of the
  // scores behind each best, and to the filters and the comparison over them.
  renderSection(
    "scores",
    buildBestScoresTable({ rows: best, total: scoreRows.length }),
    scoreRows.length,
  );
}

function renderGettingStarted(user) {
  renderPage(
    buildPage({
      header: buildHeader(),
      body: buildSection({ id: "getting-started" }),
    }),
  );

  renderHeader(getWelcome(user));

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
      header: buildHeader(),
      body: buildSections(DASHBOARD_SECTIONS),
    }),
  );

  renderHeader(
    getWelcome(user),
    getUserSubtitle(teams, models, submissions),
    getSuiteBadges(scoreRows),
  );

  renderTeamsSection(teams);
  renderModelsSection(models);
  renderSubmissionsSection(submissions);

  renderScoresSection(scoreRows);
}

// ─── SCORES VIEW ─────────────────────────────────────────────────────────────

function renderScoresView({ models, scoreRows }) {
  const display = { showModel: true, showSubmission: true };

  return renderRecordListView({
    noun: "score",
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

    panel: SCORE_PANEL,
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
    const [models, taskSubmissions, submissions, teams, user] = await Promise.all([
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
