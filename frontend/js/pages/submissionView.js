// Submission record page — dashboard, details, tasks and scores for one submission.

import { hrefForRecord } from "../core/links.js";
import { renderHtml } from "../core/render.js";
import { suiteFromTask, suiteLabel } from "../core/suites.js";
import { escapeHtml } from "../core/html.js";
import { loadModelBreakdown } from "../api/modelApi.js";
import { deleteSubmission, loadSubmission, updateSubmission } from "../api/submissionApi.js";
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
import { getSubmissionDeleteItems } from "../utils/deleteUtils.js";
import { getSubmissionBadges, getSubmissionSubtitle } from "../utils/submissionUtils.js";
import {
  getTaskSubmissionFilters,
  markStandingRows,
  mergeUpdated,
  suiteSiblings,
  toTaskSubmissionRows,
} from "../utils/taskSubmissionUtils.js";
import {
  buildStaticTaskSubmissionsTable,
  buildSubmissionScoresTable,
  createTaskSubmissionsTable,
} from "../tables/taskSubmissionTable.js";
import { SCORE_PANEL } from "../comparisons/taskScoreComparison.js";
import {
  buildButton,
  buildCancelButton,
  buildDetailsButton,
  buildEditButton,
  buildSaveButton,
  buildViewAllButton,
  EDIT_DETAILS_BUTTON,
} from "../components/buttons.js";
import { getIcon } from "../components/icons.js";
import { buildEmptyMessage, buildFailureMessage } from "../components/messages.js";
import {
  buildHeader,
  buildPage,
  buildSection,
  buildSectionFooter,
  buildSections,
  getSection,
  getSectionBody,
} from "../components/sections.js";
import { createDeleteControl } from "../widgets/deleteRecord.js";
import { renderRecordDetailsView } from "../templates/recordDetails.js";
import { loadRecordPage } from "../templates/recordPage.js";
import { renderRecordListView } from "../templates/recordList.js";
import { renderHeader, renderPage } from "../templates/pageChrome.js";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

// Where the model a submission is of lives — see the button beside Edit details.
const MODEL_PAGE = "/html/models/models.html";

// Three rows. The rest are behind the section's "view all".
const MAX_TASKS = 3;

// The render functions are declarations, so they are defined by the time this is read.
const VIEWS = {
  dashboard: renderDashboardView,
  details: renderDetailsView,
  tasks: renderTasksView,
  scores: renderScoresView,
  task: renderTaskView,
};

// Where each section's "view all" goes, by the id of the section it closes. The button
// itself is built at render — see buildFooter — because the number it names is data.
const VIEW_ALL = {
  methodology: { noun: "task", view: "tasks" },
  scores: { noun: "score", view: "scores" },
};

// The foot of the details view, for a member. The widget draws into it — see
// widgets/deleteRecord.js.
// Where a deleted submission leaves the reader.
const SUBMISSION_LIST_HREF = "/html/submissions/submission_list.html";

// The record's own fields have no count to name: the button opens one page, not a list.
const DETAILS_FOOTER = buildSectionFooter(buildDetailsButton({ view: "details" }));

const DASHBOARD_SECTIONS = [
  {
    ratio: 3,
    sections: [
      { id: "narrative", title: "Narrative" },
      { id: "methodology", title: "Task submissions" },
    ],
  },
  {
    id: "scores",
    title: "Scores",
    description:
      "What this submission scored on each task, and whether the model still stands on it.",
  },
];

// The way from a section's preview to the whole of it, under the content — see
// buildSectionFooter.
function buildFooter(id, count) {
  const { noun, ...target } = VIEW_ALL[id];

  return buildSectionFooter(buildViewAllButton(noun, target, { count }));
}

// What the section shows, with the way to the rest of it underneath.
function renderSection(id, content, footer) {
  renderHtml(getSectionBody(id), content + footer, { refresh: true });
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────

// One narrative, set as a display field is: the label above, the text below, in the same
// two classes a details card reads in — see buildDisplayField in forms/fields.js.
function buildNarrative(label, narrative) {
  return `
    <div class="column left gap-xs">
      <label class="field-label">${escapeHtml(label)}</label>
      <p class="field-value">${narrative ? escapeHtml(narrative) : "—"}</p>
    </div>
  `;
}

// One card either way. A member sees both narratives in it, a row each under its own
// heading; everyone else sees the public one, which is the only one there is — the API
// blanks the other, see withhold_private in app/schemas/submissions.py.
function renderNarrativeSection(submission, canEdit) {
  const rows = canEdit
    ? buildNarrative("Public", submission.narrative_public) +
      buildNarrative("Private", submission.narrative_private)
    : buildNarrative("Narrative", submission.narrative_public);

  renderSection(
    "narrative",
    // The scroll is the card's and not the text's inside it: one scrollbar for the pair,
    // and the headings scroll with what they head.
    `<div class="card secondary column gap-lg narrative-card">${rows}</div>`,
    DETAILS_FOOTER,
  );
}

// A table rather than cards: every task carries the same five fields, so the labels belong
// in a header read once instead of on every row. The rest are behind the section's "view
// all", where the same table holds all of them.
function renderMethodologySection(submission, canEdit) {
  const container = getSectionBody("methodology");
  const rows = toTaskSubmissionRows(submission);

  if (!rows.length) {
    renderHtml(container, buildEmptyMessage("No tasks yet"));
    return;
  }

  renderSection(
    "methodology",
    buildStaticTaskSubmissionsTable({
      rows,
      showEdit: canEdit,
      showScore: false,
      limit: MAX_TASKS,
    }),
    buildFooter("methodology", rows.length),
  );
}

// Hidden rather than emptied for a submission with nothing scored: the tasks table below
// already says what it holds.
function renderScoresSection(rows) {
  if (!rows.some((row) => row.mean_score != null)) {
    getSection("scores").hidden = true;
    return;
  }

  renderSection("scores", buildSubmissionScoresTable({ rows }), buildFooter("scores", rows.length));
}

function renderDashboardView(context) {
  const { submission, breakdown, canEdit } = context;

  // The model this is a submission of. The subtitle names it; this is the way to it, and it
  // is offered to every reader — a public submission's model is public too. `mine` off the
  // same answer: whoever may edit this is on the team that owns both.
  const model = buildButton({
    label: "View model",
    icon: getIcon("model"),
    href: hrefForRecord(MODEL_PAGE, submission.model_id, { mine: canEdit }),
    className: "primary",
  });

  renderPage(
    buildPage({
      header: buildHeader(canEdit ? [EDIT_DETAILS_BUTTON, model] : [model]),
      body: buildSections(DASHBOARD_SECTIONS),
    }),
  );

  renderHeader(
    submission.label,
    getSubmissionSubtitle(submission),
    getSubmissionBadges(submission),
  );

  renderNarrativeSection(submission, canEdit);
  renderMethodologySection(submission, canEdit);
  renderScoresSection(markStandingRows(toTaskSubmissionRows(submission), breakdown));
}

// ─── DETAILS VIEW ────────────────────────────────────────────────────────────

function renderDetailsView({ submission, fields, canEdit, edit, created }) {
  const page = renderRecordDetailsView({
    noun: "submission",
    record: submission,
    fields,
    panels: SUBMISSION_PANELS,
    canEdit,
    edit,
    created,
    dashboard: true,

    // Any member may delete a submission, which is the rule that gates editing it.
    deletable: true,

    renderTitle: (shown) => renderHeader(shown.label, getSubmissionSubtitle(shown)),
  });

  if (!page) return null;

  createDeleteControl({
    noun: "submission",
    name: () => submission.label,
    items: () => getSubmissionDeleteItems(submission),

    // `force`, so a submitted or scored submission goes too. The create form's Remove
    // button is the caller that wants the narrower rule.
    remove: () => deleteSubmission(submission.id, { force: true }),
    onDeleted: () => window.location.assign(SUBMISSION_LIST_HREF),
  }).attach();

  return page.attachEditor({ save: (draft) => updateSubmission(submission.id, draft) });
}

// ─── TASKS VIEW ──────────────────────────────────────────────────────────────

// What the dashboard's methodology cards show, for every task rather than the first few:
// the task, how it was produced, and the way in to change it.
//
// Neither `panel` nor `picking`, which is what leaves the rows unpickable — see
// templates/listView.js, where the two together are what make a list comparable. This one
// is only ever read and edited.
function renderTasksView({ submission, canEdit }) {
  return renderRecordListView({
    noun: "task",
    renderTitle: () => renderHeader(submission.label, getSubmissionSubtitle(submission)),
    empty: "No tasks yet.",

    rows: toTaskSubmissionRows(submission),

    createTable: ({ rows, selection }) =>
      createTaskSubmissionsTable({
        rows,
        selection,
        showEdit: canEdit,
        showScore: false,
        showFilters: false,
      }),
  });
}

// ─── SCORES VIEW ─────────────────────────────────────────────────────────────

// The same tasks read as scores: the numbers and the methodology behind them, narrowed by
// the filter bar and compared in the panel underneath.
//
// No Edit column. A reader here is picking rows apart, and changing one is the tasks view's
// own job.
function renderScoresView({ submission }) {
  return renderRecordListView({
    noun: "task",
    renderTitle: () => renderHeader(submission.label, getSubmissionSubtitle(submission)),
    empty: "No tasks yet.",

    rows: toTaskSubmissionRows(submission),

    createTable: ({ rows, selection }) =>
      createTaskSubmissionsTable({
        rows,
        selection,
        showEdit: false,
        showFilters: false,
      }),

    filterControls: getTaskSubmissionFilters,

    panel: SCORE_PANEL,
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
  return [suiteLabel(suiteFromTask(taskSubmission.task_id)), submission.label, submission.team_name]
    .filter(Boolean)
    .join(" · ");
}

function renderTaskView({ submission, taskFields, task, canEdit, edit = false }) {
  const taskSubmission = (submission.task_submissions ?? []).find((row) => row.id === task);

  // `task` is a durable param, so this view is entered from the URL as well as from the
  // table — a deep link, a refresh or a Back can name a task this submission hasn't got.
  if (!taskSubmission) {
    renderPage(
      buildPage({
        header: buildHeader(),
        body: buildSection({ id: "task" }),
      }),
    );

    renderHeader(submission.label, submission.team_name ?? "");
    renderHtml(
      getSectionBody("task"),
      buildFailureMessage("That task is not part of this submission"),
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

    canEdit,
    edit,
    dashboard: "Go back to dashboard",

    renderTitle: (shown) => renderHeader(shown.task_id, getTaskSubtitle(submission, shown)),
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

    // Names what the server reported it changed, not what the page asked for. Read before
    // `onSaved` empties it — see attachRecordEditor, which reports the update first.
    savedNote: () => ({
      line: `Task ${updated.length === 1 ? "submission" : "submissions"} successfully updated`,
      detail: updated
        .map((row) => row.task_id)
        .sort()
        .join(", "),
    }),

    onSaved: () => {
      mergeUpdated(submission, updated);
      showApplyToSuite(false);

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

  // Their own submission sits inside the app, with the sidebar; anyone else's is a public
  // page and keeps the top nav.
  privateShell: (context) => context.canEdit,

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

    // After the three above rather than beside them: the model is named by the submission,
    // so there is nothing to ask for until it has arrived. Undefined on failure, which
    // leaves the scores table without a standing rather than the page without scores.
    const breakdown = await loadModelBreakdown(submission.model_id).catch(() => undefined);

    return {
      submission,
      breakdown,
      fields,
      taskFields,
      // `signedIn` as well as `is_mine`: a dev-mode API answers every request as its stub user.
      canEdit: signedIn && submission.is_mine === true,
    };
  },
});
