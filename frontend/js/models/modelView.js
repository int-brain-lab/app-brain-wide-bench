// Model record page — dashboard, details, submissions and scores for one model.

import { formatDate, showError, showMessage } from "../utils.js";
import { panelGroups } from "../components/fields/groups.js";
import { renderDisplayFields } from "../components/fields/render.js";
import { Editor } from "../pages/editor.js";
import { loadModelFields, MODEL_PANELS } from "./modelSchema.js";
import { loadModel, updateModel } from "./modelApi.js";
import { buildSuiteScoreBars } from "../components/bars.js";
import { renderStaticTable } from "../components/table.js";
import {
  renderSubmissionsTable,
  submissionColumns,
  toRow as toSubmissionRow,
} from "../submissions/submissionTable.js";
import {
  countTasks,
  getMeanScores,
  scoresBySuite,
} from "../scores/scoreData.js";
import { appendCreateCard, renderCreateRow } from "../components/create-card.js";
import { renderTaskScoresTable } from "../scores/scoreTable.js";
import { getTaskSuites } from "../tasks/taskSubmissionApi.js";
import { loadRecordPage } from "../pages/record-loader.js";
import {
  buildBody,
  buildHeader,
  buildMessage,
  buildPage,
  buildSection,
  buildSections,
  buildStats,
  pageMessage,
  renderHeader,
  renderPage,
  sectionBody,
  sectionCreate,
  renderDetails,
} from "../pages/record-page.js";
import { buildStatCards } from "../components/cards.js";

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

const EDIT_ACTION = {
  id: "edit-button",
  label: "Edit",
  icon: "pencil",
};

const SAVE_ACTION = {
  id: "save-button",
  label: "Save",
  icon: "check",
  className: "primary",
  hidden: true,
};

const CANCEL_ACTION = {
  id: "cancel-button",
  label: "Cancel",
  icon: "x",
  hidden: true,
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

function getRecentSubmissions(submissions) {
  return [...submissions]
    .sort(
      (a, b) =>
        new Date(b.updated_at).getTime() -
        new Date(a.updated_at).getTime(),
    )
    .slice(0, MAX_SUBMISSIONS);
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
          ${renderDisplayFields(fieldNames, model, fields)}
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
  const recentSubmissions = getRecentSubmissions(submissions);
  const container = sectionBody("submissions");

  if (!recentSubmissions.length) {
    showMessage(container, "This model has no submissions.");
  } else {
    container.innerHTML = renderStaticTable({
      columns: submissionColumns(),
      rows: recentSubmissions.map(toSubmissionRow),
    });
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
  document.getElementById("edit-button").addEventListener("click", () => {
    router.goTo("details", { edit: true });
  });
}

function renderDetailsView({ model, fields, edit = false, created = false })  {
  renderPage(
    buildPage({
      back: BACK,
      header: buildHeader([EDIT_ACTION, SAVE_ACTION, CANCEL_ACTION]),
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

  Editor({
    container: sectionBody("body"),
    editButton: document.getElementById("edit-button"),
    saveButton: document.getElementById("save-button"),
    cancelButton: document.getElementById("cancel-button"),
    record: model,
    fields,
    groups: () => panelGroups(fields, MODEL_PANELS, { columns: 1 }),
    save: draft => updateModel( model.id, draft ),

    onSaved: saved => {
      showMessage(pageMessage(), "");
      renderHeader(saved.name, getSubtitle(saved));
      renderDetails(saved, fields, MODEL_PANELS);
    },

    onCancel: () => {
      renderDetails(model, fields, MODEL_PANELS);
    },

    onError: message => {
      showError(pageMessage(), message);
    },
  }).attach();

  if (edit) {
    document.getElementById("edit-button").click();
  }
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

function renderScoresView({ model, knownTasks }) {
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
    submissions: model.submissions ?? [],
    tasks: knownTasks,
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
    const [model, fields, knownTasks] = await Promise.all([
      loadModel(modelId),
      loadModelFields(),
      getTaskSuites(),
    ]);

    if (!model) {
      return null;
    }

    return {
      model,
      fields,
      knownTasks,
      dashboardData: getDashboardData(model),
    };
  },
});