// Model record page — dashboard, details, submissions and scores for one model.

import { formatDate, showEmpty, showSuccess } from "../core/utils.js";
import { getIcon } from "../components/icons.js";
import { buildSuiteBadgeList, buildVisibleBadge } from "../components/badges.js";
import { suitesFromSubmission } from "../core/suites.js";
import { sortSuites } from "../tables/formatters.js";
import { buildDisplayFields } from "../forms/fields.js";
import { attachEditLink, attachRecordEditor } from "../templates/record-editor.js";
import { loadModelFields, MODEL_FIELDS, MODEL_PANELS } from "../schemas/modelSchema.js";
import { loadModel, updateModel } from "../api/modelApi.js";
import { buildSuiteScoreBars } from "../components/bars.js";
import {
  renderStaticSubmissionsTable,
  renderSubmissionsTable,
} from "../tables/submissionTable.js";
import {
  countTasks,
  getMeanScores,
  scoresBySuite,
} from "../core/scoreData.js";
import { appendCreateCard } from "../cards/createCard.js";
import { renderTaskScoresTable, toScoreRows } from "../tables/scoreTable.js";
import { loadRecordPage } from "../templates/record-loader.js";
import {
  buildBody,
  buildHeader,
  buildPage,
  buildSection,
  buildSections,
  buildStats,
  EDIT_ACTION,
  EDIT_ACTIONS,
  pageMessage,
  POST_CREATE_SECTION,
  renderDetails,
  renderHeader,
  renderPage,
  sectionBody,
} from "../templates/record-page.js";
import { buildStatCards } from "../cards/statCards.js";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

const MAX_SUBMISSIONS = 3;

// TODO: Replace with ranks calculated from the leaderboard.
const RANKS = {
  ts1: 1,
  ts2: 3,
  ts3: 8,
  overall: 3,
};

const DASHBOARD_SECTIONS = [
  {
    id: "scores",
    title: "Task Suites",
    view: "scores",
    linkIcon: getIcon("model"),
    linkText: "View task scores",
  },
  {
    id: "details",
    title: "Model details",
    view: "details",
    linkIcon: getIcon("details"),
    linkText: "View model details",
  },
  {
    id: "submissions",
    title: "Recent submissions",
    view: "submissions",
    linkIcon: getIcon("submission"),
    linkText: "View all submissions",
  },
];

const BACK = {
  text: "← Back to dashboard",
  view: "dashboard",
};

// ─── DATA ────────────────────────────────────────────────────────────────────

function getStatistics(submissions, meanScores, taskCount) {
  return [
    ["submissions", submissions.length, getIcon("submission")],
    ["task suites", Object.keys(meanScores).length - 1, getIcon("suite")],
    ["tasks", taskCount, getIcon("task")],
  ];
}

function getDashboardData(model) {
  const submissions = model.submissions ?? [];
  const suiteScores = scoresBySuite(submissions);
  const meanScores = getMeanScores(suiteScores);

  return {
    submissions,
    meanScores,
    taskCount: countTasks(suiteScores),
  };
}

// ─── UTILS ───────────────────────────────────────────────────────────────────

// The suites come from the submissions rather than `model.task_suites`: the detail response
// leaves that field empty — only the list endpoint computes it — and deriving it here has
// the same effect anyway, since a non-member is only sent public submissions.
//
// Public means "has a submission anyone can read", which is also what makes the model
// visible to a stranger at all.
function getBadges(model) {
  const submissions = model.submissions ?? [];
  const suites = sortSuites([...new Set(submissions.flatMap(suitesFromSubmission))]);
  const isPublic = submissions.some(({ is_public }) => is_public);

  return [buildSuiteBadgeList(suites), buildVisibleBadge(isPublic)];
}

function getSubtitle(model) {
  return [
    { text: model.team_name, icon: getIcon("team") },
    { text: model.created_at ? `Created ${formatDate(model.created_at)}` : null, icon: getIcon("created") },
  ].filter(entry => entry.text);
}


// Beside Edit rather than under the submissions list: it belongs to the model, not to the
// three rows the dashboard happens to show, and a member is as likely to want it before
// reading them as after.
function getCreateAction(model) {
  return {
    ...getSubmissionLink(model),
    label: "New submission",
    icon: getIcon("add"),
    className: "primary-inv",
  };
}

// Beside the submission action rather than in the scores section: the comparison is about
// the model as a whole, and a reader who wants it does not have to have read the scores
// first. Offered to anyone, member or not — it reads exactly what this page already shows.
function getCompareAction(model) {
  return {
    href: `/html/models/compare.html?id=${encodeURIComponent(model.id)}`,
    label: "Compare",
    icon: getIcon("compare"),
  };
}

function getSubmissionLink(model) {
  return {
    href: `/html/submissions/submission_create.html?model=${encodeURIComponent(
      model.id,
    )}`,
    label: "New submission for this model",
  };
}

// ─── DASHBOARD SECTIONS ──────────────────────────────────────────────────────

function renderStatsSection(statistics) {
  sectionBody("stats").innerHTML = buildStatCards(statistics);
}

function renderScoresSection(meanScores) {
  sectionBody("scores").innerHTML = buildSuiteScoreBars(
    meanScores,
    RANKS,
  );
}

function renderDetailsSection(model, fields) {
  const fieldColumns = [
    ["team_name", "temporal_context_s"],
    ["created_at", "link_code"],
  ];

  const columns = fieldColumns
    .map(
      fieldNames => `
        <span class="column gap-md">
          ${buildDisplayFields(fieldNames, model, fields)}
        </span>
      `,
    )
    .join("");

  sectionBody("details").innerHTML = `
    <div class="card row">
      ${columns}
    </div>
  `;
}

function renderSubmissionsSection(submissions) {
  const container = sectionBody("submissions");

  if (!submissions.length) {
    showEmpty(container, "No submissions yet.");
    return;
  }

  renderStaticSubmissionsTable({ container, submissions, limit: MAX_SUBMISSIONS });
}

// ─── VIEWS ───────────────────────────────────────────────────────────────────

function renderDashboardView(context, router) {
  const { model, fields, dashboardData, canEdit } = context;
  const { submissions, meanScores, taskCount } = dashboardData;
  const statistics = getStatistics(
    submissions,
    meanScores,
    taskCount,
  );

  renderPage(
    buildPage({
      header: buildHeader(
        canEdit
          ? [getCompareAction(model), getCreateAction(model), EDIT_ACTION]
          : [getCompareAction(model)],
      ),
      body: buildStats() + buildSections(DASHBOARD_SECTIONS),
    }),
  );

  renderHeader(model.name, getSubtitle(model), getBadges(model));

  renderStatsSection(statistics);
  renderScoresSection(meanScores);
  renderDetailsSection(model, fields);
  renderSubmissionsSection(submissions);

  // Edit button that goes directly to full model editing view
  if (canEdit) attachEditLink(router);
}

function renderDetailsView({ model, fields, canEdit, edit = false, created = false })  {
  renderPage(
    buildPage({
      back: BACK,
      header: buildHeader(canEdit ? EDIT_ACTIONS : []),
      body: buildBody() + (created ? buildSection({ id: POST_CREATE_SECTION }) : ""),
    }),
  );

  renderHeader(model.name, getSubtitle(model));
  renderDetails(model, fields, MODEL_PANELS);

  // renderDetails has already written the read-only fields, so a reader who may not edit
  // has the whole view without the editor being wired at all.
  if (!canEdit) return;

  // Only when model_create.html sent us here. A model registered moments ago has nothing
  // submitted against it, and this is the one visit where that is known without asking.
  if (created) {
    showSuccess(pageMessage(), "Model successfully created.");

    appendCreateCard(sectionBody(POST_CREATE_SECTION), {
      href: `/html/submissions/submission_create.html?model=${encodeURIComponent(model.id)}`,
      label: "Make your first submission for this model",
    });
  }

  attachRecordEditor({
    noun: "model",
    record: model,
    fields,
    panels: MODEL_PANELS,
    save: draft => updateModel(model.id, draft),
    renderTitle: saved => renderHeader(saved.name, getSubtitle(saved)),
    edit,
  });
}

function renderSubmissionsView({ model }) {
  renderPage(
    buildPage({
      back: BACK,
      header: buildHeader(),
      body: buildBody(),
    }),
  );

  renderHeader(model.name, getSubtitle(model));

  return renderSubmissionsTable({
    container: sectionBody("body"),
    submissions: model.submissions ?? [],
  });
}

function renderScoresView({ model }) {
  renderPage(
    buildPage({
      back: BACK,
      header: buildHeader(),
      body: buildBody(),
    }),
  );

  renderHeader(model.name, getSubtitle(model));

  return renderTaskScoresTable({
    container: sectionBody("body"),
    rows: toScoreRows(model.submissions ?? []),
    showModel: false,
    showSubmission: true,
  });
}

// ─── LOAD ────────────────────────────────────────────────────────────────────

const VIEWS = {
  dashboard: renderDashboardView,
  details: renderDetailsView,
  submissions: renderSubmissionsView,
  scores: renderScoresView,
};

loadRecordPage({
  views: VIEWS,
  noun: "model",
  flags: ["edit", "created"],

  // A model with a public submission is readable by anyone — see GET /api/models/{id}.
  requiresAuth: false,

  load: async (modelId, { signedIn }) => {
    const [model, fields] = await Promise.all([
      loadModel(modelId),
      // loadModelFields fills the Team select from /api/users/me/teams, which a signed-out
      // reader can't fetch and doesn't need: a display row renders the stored value, not an
      // option's label. The bare schema is the whole read-only view.
      signedIn ? loadModelFields() : MODEL_FIELDS,
    ]);

    if (!model) {
      return null;
    }

    return {
      model,
      fields,
      // Both halves. `can_edit` is team membership as the API sees it — the same rule PATCH
      // enforces, and signing in alone doesn't earn it. `signedIn` is this browser having a
      // session at all: a dev-mode API answers every request as its stub user, so without
      // this a signed-out visitor would be offered edit controls locally.
      canEdit: signedIn && model.can_edit === true,
      dashboardData: getDashboardData(model),
    };
  },
});