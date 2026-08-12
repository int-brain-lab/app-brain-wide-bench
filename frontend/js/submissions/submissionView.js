// Submission record page — dashboard, details, tasks and scores for one submission.

import { formatDate, showError, showMessage } from "../utils.js";
import { panelGroups, renderDisplayFields } from "../utils/form-fields.js";
import { Editor } from "../utils/editor.js";
import { loadSubmissionFields, SUBMISSION_PANELS } from "./submissionSchema.js";
import { loadSubmission, updateSubmission } from "./submissionApi.js";
import { renderStaticTable } from "../utils/tables.js";
import {
  renderTaskSubmissionsTable,
  taskSubmissionColumns,
  toRow as toTaskRow,
} from "../tasks/taskSubmissionTable.js";
import {
  renderTaskScoresTable,
  scoreSorter,
  taskScoreColumns,
  toRows as toTaskScoreRows,
} from "../scores/scoreTable.js";
import { suitesFromSubmission } from "../utils/suites.js";
import { getTasks } from "../tasks/taskSubmissionApi.js";
import { buildStatCards } from "../components/cards.js";
import { loadRecordPage } from "../pages/record-loader.js";
import {
  buildBody,
  buildHeader,
  buildMessage,
  buildPage,
  buildSections,
  buildStats,
  pageMessage,
  renderDetails,
  renderHeader,
  renderPage,
  sectionBody,
} from "../pages/record-page.js";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

const SCORE_LIMIT = 5;

const SUMMARY_KEYS = [
  "label",
  "status",
  "is_public",
  "created_at",
  "updated_at",
];

const DASHBOARD_SECTIONS = [
  {
    id: "scores",
    title: "Task Scores",
    view: "scores",
    linkIcon: "book-open",
    linkText: "View task scores",
  },
  {
    id: "details",
    title: "Submission Details",
    view: "details",
    linkIcon: "book-open",
    linkText: "View submission details",
  },
  {
    id: "tasks",
    title: "Task Submissions",
    view: "tasks",
    linkIcon: "chart-column",
    linkText: "View task details",
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

function getStatistics(submission, taskSubmissions) {
  return [
    ["tasks", taskSubmissions.length, "list-checks"],
    ["task suites", suitesFromSubmission(submission).length, "grid-3x3"],
    ["scoring status", submission.status, "check-check"],
    ["visibility", submission.is_public ? "Public" : "Private", "globe"],
  ];
}

function getTopScores(submission, knownTasks) {
  return toTaskScoreRows([submission], knownTasks)
    .sort((a, b) => scoreSorter(b.mean_score, a.mean_score))
    .slice(0, SCORE_LIMIT);
}

function getDashboardData(submission) {
  return {
    taskSubmissions: submission.task_submissions ?? [],
  };
}

// ─── UTILS ───────────────────────────────────────────────────────────────────

function getSubtitle(submission) {
  return [
    submission.model_name,
    submission.team_name,
    submission.created_at ? `Created ${formatDate(submission.created_at)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

// ─── DASHBOARD SECTIONS ──────────────────────────────────────────────────────

function renderStatsSection(statistics) {
  sectionBody("stats").innerHTML = buildStatCards(statistics);
}

function renderScoresSection(submission, knownTasks) {
  const rows = getTopScores(submission, knownTasks);
  const container = sectionBody("scores");

  if (!rows.length) {
    showMessage(container, "No scores yet — this submission hasn't been scored.");
    return;
  }

  container.innerHTML = renderStaticTable({
    columns: taskScoreColumns({ showSubmission: false }),
    rows,
  });
}

function renderDetailsSection(submission, fields) {
  const keys = SUMMARY_KEYS.filter(key => key in fields);
  const midpoint = Math.ceil(keys.length / 2);

  const columns = [keys.slice(0, midpoint), keys.slice(midpoint)]
    .map(
      fieldNames => `
        <span class="column gap-md">
          ${renderDisplayFields(fieldNames, submission, fields)}
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

function renderTasksSection(submission, taskSubmissions) {
  const container = sectionBody("tasks");

  if (!taskSubmissions.length) {
    showMessage(container, "This submission has no tasks.");
    return;
  }

  container.innerHTML = renderStaticTable({
    columns: taskSubmissionColumns(),
    rows: taskSubmissions.map(taskSubmission => toTaskRow(submission, taskSubmission)),
  });
}

// ─── VIEWS ───────────────────────────────────────────────────────────────────

function renderDashboardView(context, router) {
  const { submission, fields, knownTasks, dashboardData } = context;
  const { taskSubmissions } = dashboardData;

  renderPage(
    buildPage({
      header: buildHeader([EDIT_ACTION]),
      body: buildStats() + buildSections(DASHBOARD_SECTIONS),
    }),
  );

  renderHeader(submission.label, getSubtitle(submission));

  renderStatsSection(getStatistics(submission, taskSubmissions));
  renderScoresSection(submission, knownTasks);
  renderDetailsSection(submission, fields);
  renderTasksSection(submission, taskSubmissions);

  // Edit button that goes directly to full submission editing view
  document.getElementById("edit-button").addEventListener("click", () => {
    router.goTo("details", { edit: true });
  });
}

function renderDetailsView({ submission, fields, edit = false }) {
  renderPage(
    buildPage({
      back: BACK,
      header: buildHeader([EDIT_ACTION, SAVE_ACTION, CANCEL_ACTION]),
      body: buildMessage() + buildBody(),
    }),
  );

  renderHeader(submission.label, getSubtitle(submission));
  renderDetails(submission, fields, SUBMISSION_PANELS);

  Editor({
    container: sectionBody("body"),
    editButton: document.getElementById("edit-button"),
    saveButton: document.getElementById("save-button"),
    cancelButton: document.getElementById("cancel-button"),
    record: submission,
    fields,
    groups: () => panelGroups(fields, SUBMISSION_PANELS, { columns: 1 }),
    save: draft => updateSubmission(submission.id, draft),

    onSaved: saved => {
      showMessage(pageMessage(), "");
      renderHeader(saved.label, getSubtitle(saved));
      renderDetails(saved, fields, SUBMISSION_PANELS);
    },

    onCancel: () => {
      renderDetails(submission, fields, SUBMISSION_PANELS);
    },

    onError: message => {
      showError(pageMessage(), message);
    },
  }).attach();

  if (edit) {
    document.getElementById("edit-button").click();
  }
}

function renderTasksView({ submission }) {
  renderPage(
    buildPage({
      back: BACK,
      header: buildHeader(),
      body: buildMessage() + buildBody(),
    }),
  );

  renderHeader(submission.label, getSubtitle(submission));

  if (!submission.task_submissions?.length) {
    showMessage(pageMessage(), "This submission has no tasks yet.");
    return;
  }

  return renderTaskSubmissionsTable({
    container: sectionBody("body"),
    submission,
  });
}

function renderScoresView({ submission, knownTasks }) {
  renderPage(
    buildPage({
      back: BACK,
      header: buildHeader(),
      body: buildMessage() + buildBody(),
    }),
  );

  renderHeader(submission.label, getSubtitle(submission));

  if (!submission.task_submissions?.length) {
    showMessage(pageMessage(), "This submission has no scored tasks yet.");
    return;
  }

  // Neither model nor submission is a column — every row belongs to this one submission.
  return renderTaskScoresTable({
    container: sectionBody("body"),
    submissions: [submission],
    tasks: knownTasks,
    showModel: false,
    showSubmission: false,
  });
}

// ─── LOAD ────────────────────────────────────────────────────────────────────

const VIEWS = {
  dashboard: renderDashboardView,
  details: renderDetailsView,
  tasks: renderTasksView,
  scores: renderScoresView,
};

loadRecordPage({
  views: VIEWS,
  noun: "submission",
  flags: ["edit"],

  load: async submissionId => {
    const [submission, fields, knownTasks] = await Promise.all([
      loadSubmission(submissionId),
      loadSubmissionFields(),
      getTasks(),
    ]);

    if (!submission) {
      return null;
    }

    return {
      submission,
      fields,
      knownTasks,
      dashboardData: getDashboardData(submission),
    };
  },
});
