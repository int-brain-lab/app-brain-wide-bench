// Model record page — dashboard, details, submissions and scores for one model.

import { formatDate, showMessage } from "../core/utils.js";
import { buildDisplayFields } from "../forms/fields.js";
import { attachEditLink, attachRecordEditor } from "../templates/record-editor.js";
import { loadModelFields, MODEL_PANELS } from "../schemas/modelSchema.js";
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
import { appendCreateCard, renderCreateRow } from "../cards/createCard.js";
import { renderTaskScoresTable, toScoreRows } from "../tables/scoreTable.js";
import { loadRecordPage } from "../templates/record-loader.js";
import {
  EDIT_ACTION,
  EDIT_ACTIONS,
  buildBody,
  buildHeader,
  buildMessage,
  buildPage,
  buildSection,
  buildSections,
  buildStats,
  renderHeader,
  renderPage,
  sectionBody,
  sectionCreate,
  renderDetails,
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
    linkIcon: "chart-column",
    linkText: "View task scores",
  },
  {
    id: "details",
    title: "Model details",
    view: "details",
    linkIcon: "book-open",
    linkText: "View model details",
  },
  {
    id: "submissions",
    title: "Recent submissions",
    view: "submissions",
    linkIcon: "layers",
    linkText: "View all submissions",
    create: true,
  },
];

const BACK = {
  text: "← Back to dashboard",
  view: "dashboard",
};

// ─── DATA ────────────────────────────────────────────────────────────────────

function getStatistics(submissions, meanScores, taskCount) {
  return [
    ["submissions", submissions.length, "layers"],
    ["public submissions", submissions.filter(({ is_public }) => is_public).length, "globe"],
    ["task suites", Object.keys(meanScores).length - 1, "grid-3x3"],
    ["tasks", taskCount, "list-checks"],
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

function getSubtitle(model) {
  return [
    model.team_name,
    model.created_at ? `Created ${formatDate(model.created_at)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
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

function renderSubmissionsSection(model, submissions) {
  const container = sectionBody("submissions");

  if (!submissions.length) {
    showMessage(container, "This model has no submissions.");
  } else {
    renderStaticSubmissionsTable({ container, submissions, limit: MAX_SUBMISSIONS });
  }

  renderCreateRow(
    sectionCreate("submissions"),
    getSubmissionLink(model),
  );
}

// ─── VIEWS ───────────────────────────────────────────────────────────────────

function renderDashboardView(context, router) {
  const { model, fields, dashboardData } = context;
  const { submissions, meanScores, taskCount } = dashboardData;
  const statistics = getStatistics(
    submissions,
    meanScores,
    taskCount,
  );

  renderPage(
    buildPage({
      header: buildHeader([EDIT_ACTION]),
      body: buildStats() + buildSections(DASHBOARD_SECTIONS),
    }),
  );

  renderHeader(model.name, getSubtitle(model));

  renderStatsSection(statistics);
  renderScoresSection(meanScores);
  renderDetailsSection(model, fields);
  renderSubmissionsSection(model, submissions);

  // Edit button that goes directly to full model editing view
  attachEditLink(router);
}

function renderDetailsView({ model, fields, edit = false, created = false })  {
  renderPage(
    buildPage({
      back: BACK,
      header: buildHeader(EDIT_ACTIONS),
      body: buildMessage() + buildBody() + (created ? buildSection({ id: "post-create" }) : ""),
    }),
  );

  renderHeader(model.name, getSubtitle(model));
  renderDetails(model, fields, MODEL_PANELS);

  // Only when model_create.html sent us here. A model registered moments ago has nothing
  // submitted against it, and this is the one visit where that is known without asking.
  if (created) {
    appendCreateCard(sectionBody("post-create"), {
      href: `/html/submissions/submission_create.html?model=${encodeURIComponent(model.id)}`,
      label: "Make your first submission for this model",
    });
  }

  attachRecordEditor({
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

  load: async modelId => {
    const [model, fields] = await Promise.all([
      loadModel(modelId),
      loadModelFields(),
    ]);

    if (!model) {
      return null;
    }

    return {
      model,
      fields,
      dashboardData: getDashboardData(model),
    };
  },
});