// Submission record page — dashboard, details, tasks and scores for one submission.

import { renderHtml } from "../core/render.js";
import { suiteFromTask, suiteLabel } from "../core/suites.js";
import { escapeHtml } from "../core/html.js";
import { loadSubmission, updateSubmission } from "../api/submissionApi.js";
import { updateTaskSubmissions } from "../api/taskSubmissionApi.js";
import {
  loadSubmissionFields,
  loadSubmissionMeta,
  SUBMISSION_PANELS,
} from "../schemas/submissionSchema.js";
import {
  loadTaskFields,
  TASK_PANELS,
  toMethodologyValues,
} from "../schemas/taskSubmissionSchema.js";
import {
  getSubmissionBadges,
  getSubmissionStatistics,
  getSubmissionSubtitle,
} from "../utils/submissionUtils.js";
import {
  getTaskSubmissionFilters,
  mergeUpdated,
  suiteSiblings,
  toTaskSubmissionRows,
} from "../utils/taskSubmissionUtils.js";
import {
  buildStaticTaskSubmissionsTable,
  createTaskSubmissionsTable,
} from "../tables/taskSubmissionTable.js";
import { SCORE_MODES } from "../comparisons/scoreModes.js";
import { buildDetailsCard } from "../cards/detailsCard.js";
import { buildStatCards } from "../cards/statCards.js";
import {
  buildCancelButton,
  buildEditButton,
  buildSaveButton,
} from "../components/buttons.js";
import { buildCount } from "../components/count.js";
import {
  buildEmptyMessage,
  buildFailureMessage,
  buildSuccessMessage,
} from "../components/messages.js";
import {
  buildHeader,
  buildPage,
  buildSection,
  buildSections,
  getSectionBody,
} from "../components/sections.js";
import {
  attachEditLink,
  renderRecordDetailsView,
} from "../templates/recordDetails.js";
import { loadRecordPage } from "../templates/recordPage.js";
import { renderRecordListView } from "../templates/recordList.js";
import {
  renderHeader,
  renderMessage,
  renderPage,
} from "../templates/pageChrome.js";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

const MAX_TASKS = 5;

const SUMMARY_KEYS = [
  "label",
  "status",
  "is_public",
  "created_at",
  "updated_at",
];

const BACK = {
  text: "← Back to dashboard",
  view: "dashboard",
};

const TASKS_BACK = {
  text: "← Back to tasks",
  view: "tasks",
};

// The render functions are declarations, so they are defined by the time this is read.
const VIEWS = {
  dashboard: renderDashboardView,
  details: renderDetailsView,
  tasks: renderTasksView,
  task: renderTaskView,
};

const DASHBOARD_SECTIONS = [
  {
    id: "stats",
    className: "stats-grid",
  },
  {
    sections: [
      {
        id: "narrative",
        title: "Narrative",
        // One card per narrative, stacked — the section body is a plain block otherwise.
        className: "column gap-md",
      },
      {
        id: "details",
        title: "Submission Details",
      },
    ],
  },
  {
    id: "tasks",
    title: "Task Submissions",
  },
];

// ─── DASHBOARD ───────────────────────────────────────────────────────────────

function renderStatsSection(statistics) {
  renderHtml(getSectionBody("stats"), buildStatCards(statistics));
}

function buildNarrativeCard(label, narrative) {
  return `
    <div class="card column left gap-sm">
      <p class="field-value">${escapeHtml(label)}</p>
      <p class="field-label scroll-y">${narrative ? escapeHtml(narrative) : "—"}</p>
    </div>
  `;
}

// The private narrative only for a member: the API blanks it for everyone else — see
// withhold_private in app/schemas/submissions.py.
function renderNarrativeSection(submission, canEdit) {
  renderHtml(
    getSectionBody("narrative"),
    buildNarrativeCard("Public narrative", submission.narrative_public) +
      (canEdit
        ? buildNarrativeCard("Private narrative", submission.narrative_private)
        : ""),
  );
}

function renderDetailsSection(submission, fields) {
  renderHtml(
    getSectionBody("details"),
    buildDetailsCard({
      record: submission,
      fields,
      keys: SUMMARY_KEYS,
      columns: 2,
    }),
  );
}

function renderTasksSection(submission) {
  const container = getSectionBody("tasks");

  if (!submission.task_submissions?.length) {
    renderHtml(container, buildEmptyMessage("No tasks yet."));
    return;
  }

  renderHtml(
    container,
    buildStaticTaskSubmissionsTable({
      rows: toTaskSubmissionRows(submission),
      limit: MAX_TASKS,
      viewAll: { view: "tasks" },
    }),
  );
}

function renderDashboardView(context, router) {
  const { submission, fields, canEdit } = context;

  renderPage(
    buildPage({
      header: buildHeader(canEdit ? [buildEditButton()] : []),
      body: buildSections(DASHBOARD_SECTIONS),
    }),
  );

  renderHeader(
    submission.label,
    getSubmissionSubtitle(submission),
    getSubmissionBadges(submission),
  );

  renderStatsSection(getSubmissionStatistics(submission));
  renderNarrativeSection(submission, canEdit);
  renderDetailsSection(submission, fields);
  renderTasksSection(submission);

  if (canEdit) attachEditLink(router);
}

// ─── DETAILS VIEW ────────────────────────────────────────────────────────────

function renderDetailsView({ submission, fields, canEdit, edit, created }) {
  const page = renderRecordDetailsView({
    noun: "submission",
    record: submission,
    fields,
    panels: SUBMISSION_PANELS,
    back: BACK,
    canEdit,
    edit,
    created,

    renderTitle: (shown) =>
      renderHeader(shown.label, getSubmissionSubtitle(shown)),
  });

  if (!page) return null;

  return page.attachEditor({
    save: (draft) => updateSubmission(submission.id, draft),
  });
}

// ─── TASKS VIEW ──────────────────────────────────────────────────────────────

function renderTasksView({ submission, canEdit }) {
  return renderRecordListView({
    noun: "task",
    back: BACK,
    renderTitle: () =>
      renderHeader(submission.label, getSubmissionSubtitle(submission)),
    empty: "No tasks yet.",

    rows: toTaskSubmissionRows(submission),

    createTable: ({ rows, selection }) =>
      createTaskSubmissionsTable({
        rows,
        selection,
        showEdit: canEdit,
        showFilters: false,
      }),

    filterControls: getTaskSubmissionFilters,

    modes: SCORE_MODES,
  });
}

// ─── TASK VIEW ───────────────────────────────────────────────────────────────

function buildApplyToSuite() {
  return `
    <label class="row left gap-sm" id="apply-to-suite" hidden>
      <input type="checkbox" class="field-checkbox" id="apply-to-suite-input">
      <span class="metadata" id="apply-to-suite-label"></span>
    </label>
  `;
}

function getTaskSubtitle(submission, taskSubmission) {
  return [
    suiteLabel(suiteFromTask(taskSubmission.task_id)),
    submission.label,
    submission.team_name,
  ]
    .filter(Boolean)
    .join(" · ");
}

function renderTaskView({
  submission,
  taskFields,
  task,
  canEdit,
  edit = false,
}) {
  const taskSubmission = (submission.task_submissions ?? []).find(
    (row) => row.id === task,
  );

  // `task` is a durable param, so this view is entered from the URL as well as from the
  // table — a deep link, a refresh or a Back can name a task this submission hasn't got.
  if (!taskSubmission) {
    renderPage(
      buildPage({
        back: TASKS_BACK,
        header: buildHeader(),
        body: buildSection({ id: "task" }),
      }),
    );

    renderHeader(submission.label, submission.team_name ?? "");
    renderHtml(
      getSectionBody("task"),
      buildFailureMessage("That task is not part of this submission."),
    );

    return null;
  }

  // TASK_FIELDS is the one schema whose fields invalidate each other — changing the
  // paradigm can rule out the supervision regime already chosen. Reporting that is
  // attachRecordEditor's default, which is why no onCleared appears here.
  const page = renderRecordDetailsView({
    noun: "task",
    record: taskSubmission,
    fields: taskFields,
    panels: TASK_PANELS,

    actions: [
      buildEditButton(),
      buildApplyToSuite(),
      buildCancelButton({ hidden: true }),
      buildSaveButton({ hidden: true }),
    ],

    back: TASKS_BACK,
    canEdit,
    edit,

    renderTitle: (shown) =>
      renderHeader(shown.task_id, getTaskSubtitle(submission, shown)),
  });

  if (!page) return null;

  const siblings = suiteSiblings(submission, taskSubmission);
  const applyToSuite = document.getElementById("apply-to-suite");
  const applyToSuiteInput = document.getElementById("apply-to-suite-input");

  document.getElementById("apply-to-suite-label").textContent =
    `Apply to all ${suiteLabel(suiteFromTask(taskSubmission.task_id)) ?? "matching"} tasks (${siblings.length})`;

  function showApplyToSuite(visible) {
    applyToSuite.hidden = !visible;

    if (!visible) applyToSuiteInput.checked = false;
  }

  // Set by `save`, read by `onSaved`: the editor's save must return the one record it
  // merges, so the full list of updated rows has no way through except a variable here.
  let updated = [];

  return page.attachEditor({
    // `task_id` and the model aren't editable fields, but TASK_FIELDS reads both when
    // deciding which methodology options are legal.
    context: () => ({
      task_id: taskSubmission.task_id,
      model: submission.model,
    }),

    onEdit: () => showApplyToSuite(true),

    // One bulk request for both the single-task and suite-wide cases, so the server stays
    // responsible for applying it atomically.
    save: async (draft) => {
      const targets = applyToSuiteInput.checked ? siblings : [taskSubmission];

      updated = await updateTaskSubmissions(
        submission.id,
        targets.map((target) => target.id),
        toMethodologyValues(draft),
      );

      return updated.find((row) => row.id === taskSubmission.id) ?? updated[0];
    },

    onSaved: () => {
      mergeUpdated(submission, updated);
      showApplyToSuite(false);

      // Names what the server reported it changed, not what the page asked for.
      const names = updated.map((row) => row.task_id).sort();

      renderMessage(
        buildSuccessMessage(
          names.length === 1
            ? `Updated ${names[0]}.`
            : `Updated ${buildCount(names.length, "task")}: ${names.join(", ")}.`,
        ),
      );

      updated = [];
    },

    onCancel: () => showApplyToSuite(false),
  });
}

// ─── LOAD ────────────────────────────────────────────────────────────────────

loadRecordPage({
  views: VIEWS,
  flags: ["edit", "created"],

  // `task` names the task submission the methodology view is showing. Durable: it survives
  // a refresh and a Back, which is why that view checks the id is one of this submission's.
  params: ["task"],

  noun: "submission",

  // A public submission is readable by anyone — see GET /api/submissions/{id}, which
  // withholds the team-only fields rather than the whole record.
  requiresAuth: false,

  load: async (submissionId, { signedIn }) => {
    const [submission, fields, taskFields] = await Promise.all([
      loadSubmission(submissionId),
      // Same as modelView: the Model select's options come from /api/users/me/models, which
      // only the editor needs, while loadSubmissionMeta is the help text the display rows
      // want as well. Both that and loadTaskFields read /api/meta, which is public.
      signedIn ? loadSubmissionFields() : loadSubmissionMeta(),
      loadTaskFields(),
    ]);

    if (!submission) {
      return null;
    }

    return {
      submission,
      fields,
      taskFields,
      // `signedIn` as well as `is_mine`: a dev-mode API answers every request as its stub user.
      canEdit: signedIn && submission.is_mine === true,
    };
  },
});
