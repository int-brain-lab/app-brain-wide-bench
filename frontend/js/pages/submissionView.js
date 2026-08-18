// Submission record page — dashboard, details, tasks and scores for one submission.

import { formatDate, showEmpty, showSuccess } from "../core/utils.js";
import { buildDisplayFields } from "../forms/fields.js";
import { attachEditLink, attachRecordEditor } from "../templates/record-editor.js";
import { loadSubmissionFields, SUBMISSION_FIELDS, SUBMISSION_PANELS } from "../schemas/submissionSchema.js";
import { loadSubmission, updateSubmission } from "../api/submissionApi.js";
import {
  renderStaticTaskSubmissionsTable,
  renderTaskSubmissionsTable,
} from "../tables/taskSubmissionTable.js";
import {
  renderStaticTaskScoresTable,
  renderTaskScoresTable,
  toScoreRows,
} from "../tables/scoreTable.js";
import { suitesFromSubmission } from "../core/suites.js";
import { loadTaskFields } from "../schemas/taskSubmissionSchema.js";
import { renderTaskView } from "./taskSubmissionView.js";
import { buildStatCards } from "../cards/statCards.js";
import { loadRecordPage } from "../templates/record-loader.js";
import {
  buildBody,
  buildHeader,
  buildPage,
  buildSections,
  buildStats,
  EDIT_ACTION,
  EDIT_ACTIONS,
  pageMessage,
  renderDetails,
  renderHeader,
  renderPage,
  sectionBody,
} from "../templates/record-page.js";

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


// ─── DATA ────────────────────────────────────────────────────────────────────

function getStatistics(submission, taskSubmissions) {
  return [
    ["tasks", taskSubmissions.length, "list-checks"],
    ["task suites", suitesFromSubmission(submission).length, "grid-3x3"],
    ["scoring status", submission.status, "check-check"],
    ["visibility", submission.is_public ? "Public" : "Private", "globe"],
  ];
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

function renderScoresSection(submission) {
  const rows = toScoreRows([submission]);
  const container = sectionBody("scores");

  if (!rows.length) {
    showEmpty(container, "No scored tasks yet.");
    return;
  }

  renderStaticTaskScoresTable({
    container,
    rows,
    showSubmission: false,
    limit: SCORE_LIMIT,
  });
}

function renderDetailsSection(submission, fields) {
  const keys = SUMMARY_KEYS.filter(key => key in fields);
  const midpoint = Math.ceil(keys.length / 2);

  const columns = [keys.slice(0, midpoint), keys.slice(midpoint)]
    .map(
      fieldNames => `
        <span class="column gap-md">
          ${buildDisplayFields(fieldNames, submission, fields)}
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
    showEmpty(container, "No tasks yet.");
    return;
  }

  renderStaticTaskSubmissionsTable({ container, submission });
}

// ─── VIEWS ───────────────────────────────────────────────────────────────────

function renderDashboardView(context, router) {
  const { submission, fields, dashboardData, canEdit } = context;
  const { taskSubmissions } = dashboardData;

  renderPage(
    buildPage({
      header: buildHeader(canEdit ? [EDIT_ACTION] : []),
      body: buildStats() + buildSections(DASHBOARD_SECTIONS),
    }),
  );

  renderHeader(submission.label, getSubtitle(submission));

  renderStatsSection(getStatistics(submission, taskSubmissions));
  renderScoresSection(submission);
  renderDetailsSection(submission, fields);
  renderTasksSection(submission, taskSubmissions);

  // Edit button that goes directly to full submission editing view
  if (canEdit) attachEditLink(router);
}

function renderDetailsView({ submission, fields, canEdit, edit = false, created = false }) {
  renderPage(
    buildPage({
      back: BACK,
      header: buildHeader(canEdit ? EDIT_ACTIONS : []),
      body: buildBody(),
    }),
  );

  renderHeader(submission.label, getSubtitle(submission));
  renderDetails(submission, fields, SUBMISSION_PANELS);

  // Only when submission_create.html sent us here.
  if (created) showSuccess(pageMessage(), "Submission successfully created.");

  // renderDetails has already written the read-only fields, so a reader who may not edit
  // has the whole view without the editor being wired at all.
  if (!canEdit) return;

  attachRecordEditor({
    noun: "submission",
    record: submission,
    fields,
    panels: SUBMISSION_PANELS,
    save: draft => updateSubmission(submission.id, draft),
    renderTitle: saved => renderHeader(saved.label, getSubtitle(saved)),
    edit,
  });
}

function renderTasksView({ submission, canEdit }) {
  renderPage(
    buildPage({
      back: BACK,
      header: buildHeader(),
      body: buildBody(),
    }),
  );

  renderHeader(submission.label, getSubtitle(submission));

  if (!submission.task_submissions?.length) {
    showEmpty(sectionBody("body"), "No tasks yet.");
    return;
  }

  return renderTaskSubmissionsTable({
    container: sectionBody("body"),
    submission,
    showEdit: canEdit,
  });
}

function renderScoresView({ submission }) {
  renderPage(
    buildPage({
      back: BACK,
      header: buildHeader(),
      body: buildBody(),
    }),
  );

  renderHeader(submission.label, getSubtitle(submission));

  if (!submission.task_submissions?.length) {
    showEmpty(sectionBody("body"), "No scored tasks yet.");
    return;
  }

  // Neither model nor submission is a column — every row belongs to this one submission.
  return renderTaskScoresTable({
    container: sectionBody("body"),
    rows: toScoreRows([submission]),
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
  task: renderTaskView,
};

loadRecordPage({
  views: VIEWS,
  noun: "submission",
  flags: ["edit", "created"],
  params: ["task"],

  // A public submission is readable by anyone — see GET /api/submissions/{id}, which
  // withholds the team-only fields rather than the whole record.
  requiresAuth: false,

  load: async (submissionId, { signedIn }) => {
    const [submission, fields, taskFields] = await Promise.all([
      loadSubmission(submissionId),
      // Same as modelView: the Model select's options come from /api/users/me/models, which
      // only the editor needs. loadTaskFields is /api/meta/enums, which is public.
      signedIn ? loadSubmissionFields() : SUBMISSION_FIELDS,
      loadTaskFields(),
    ]);

    if (!submission) {
      return null;
    }

    return {
      submission,
      fields,
      taskFields,
      // Both halves, as in modelView: `can_edit` is team membership as the API sees it, and
      // `signedIn` is this browser having a session — a dev-mode API answers every request
      // as its stub user, so without it a signed-out visitor would be offered edit controls.
      canEdit: signedIn && submission.can_edit === true,
      dashboardData: getDashboardData(submission),
    };
  },
});
