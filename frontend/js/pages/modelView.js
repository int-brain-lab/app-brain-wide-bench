// Model record page — dashboard, details, submissions and scores for one model.

import { formatDate, showEmpty, showSuccess } from "../core/utils.js";
import { getIcon } from "../components/icons.js";
import { buildPretrainedBadge, buildSuiteBadgeList, buildVisibleBadge } from "../components/badges.js";
import { suitesFromSubmission } from "../core/suites.js";
import { sortSuites } from "../tables/formatters.js";
import { buildDisplayFields } from "../forms/fields.js";
import { attachEditLink, attachRecordEditor } from "../templates/record-editor.js";
import { loadModelFields, loadModelMeta, MODEL_PANELS } from "../schemas/modelSchema.js";
import { getModelRanking, loadModel, updateModel } from "../api/modelApi.js";
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
import { buildRankCard } from "../cards/rankCard.js";
import { markRankedRows } from "../core/rankData.js";
import { renderStaticTaskScoresTable, toScoreRows } from "../tables/scoreTable.js";
import { renderTaskScoreExplorer } from "../widgets/taskScoreExplorer.js";
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
const MAX_SCORES = 5;

const DASHBOARD_SECTIONS = [
  {
    id: "ranking",
    title: "Best Rank",
  },
  {
    id: "scores",
    title: "Task scores",
    // view: "scores",
    // linkIcon: getIcon("model"),
    // linkText: "View task scores",
  },
  {
    id: "details",
    title: "Model details",
    // view: "details",
    // linkIcon: getIcon("details"),
    // linkText: "View model details",
  },
  {
    id: "submissions",
    title: "Recent submissions",
    // view: "submissions",
    // linkIcon: getIcon("submission"),
    // linkText: "View all submissions",
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

  // Pretraining is a fact about the model, so it sits with the suites; visibility is about
  // who may read it, and stays last.
  return [
    buildSuiteBadgeList(suites),
    buildPretrainedBadge(model.is_pretrained),
    buildVisibleBadge(isPublic),
  ];
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
    className: "primary",
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

// Above the suite bars rather than beside the counts: it is the same question they answer
// — how is this model doing — at the coarsest grain, and the bars underneath break it down.
//
// The submit link only for a member: a suite this model has never entered is an invitation
// to its own team and a dead end for anyone else.
function renderRankingSection(ranking, model, canEdit) {
  sectionBody("ranking").innerHTML = buildRankCard(ranking, {
    submitHref: canEdit ? getSubmissionLink(model).href : null,
  });
}

// The same table the scores view draws, static and cut to a preview: the ranking beside it
// answers "how does this model place", and this answers "on what" — which is a list of
// tasks rather than a summary of suites.
function renderScoresSection(submissions, ranking) {
  const container = sectionBody("scores");
  const rows = markRankedRows(toScoreRows(submissions), ranking);

  if (!rows.length) {
    showEmpty(container, "No scores yet.");
    return;
  }

  renderStaticTaskScoresTable({
    container,
    rows,
    // No Submission column: the preview shares its row with the ranking card, and the
    // width is better spent on the task than on which run scored it. The full view, one
    // click away in the footer, still says.
    showSubmission: false,
    showRanking: true,
    limit: MAX_SCORES,
    viewAll: { view: "scores" },
  });
}

function renderDetailsSection(model, fields) {
  const fieldColumns = [[
    "team_name", "link_code", "is_pretrained", "created_at",
  ]];

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
    <div class="card corner-link">
      <!-- grid-2, not .row: .row is space-between, which pins the second column to the
           card's right edge instead of starting it at the halfway mark. -->
      <div>
        ${columns}
      </div>

      <!-- Where the section heading's own link goes; the router picks it up by data-view.
           The card's corner-link class lifts this onto the last row of fields. -->
      <a class="link" href="#" data-view="details">View all details →</a>
    </div>
  `;
}

function renderSubmissionsSection(submissions) {
  const container = sectionBody("submissions");

  if (!submissions.length) {
    showEmpty(container, "No submissions yet.");
    return;
  }

  renderStaticSubmissionsTable({
    container,
    submissions,
    limit: MAX_SUBMISSIONS,
    viewAll: { view: "submissions" },
  });
}

// ─── VIEWS ───────────────────────────────────────────────────────────────────

function renderDashboardView(context, router) {
  const { model, fields, dashboardData, ranking, canEdit } = context;
  const { submissions, meanScores, taskCount } = dashboardData;
  const statistics = getStatistics(submissions, meanScores, taskCount);


  const ROW1 = [
      {
    id: "ranking",
    title: "Ranking",
  },
  {
    id: "scores",
    title: "Task scores",
  },
  ]
  const row1 = `<div class="section-row">${buildSections(ROW1)}</div>`

  const ROW2 = [
    {
    id: "details",
    title: "Model details",
  },
  {
    id: "submissions",
    title: "Recent submissions",
  },
  ]

  console.log(ROW2)
  const row2 = `<div class="section-row uneven">${buildSections(ROW2)}</div>`



  renderPage(
    buildPage({
      header: buildHeader(
        canEdit
          ? [[getCompareAction(model)], [EDIT_ACTION, getCreateAction(model)]]
          : [getCompareAction(model)],
      ),
      body: buildStats() + buildSections(ROW1) + row2,
    }),
  );

  renderHeader(model.name, getSubtitle(model), getBadges(model));

  renderStatsSection(statistics);
  renderRankingSection(ranking, model, canEdit);
  renderScoresSection(submissions, ranking);
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

function renderScoresView({ model, ranking }) {
  renderPage(
    buildPage({
      back: BACK,
      header: buildHeader(),
      body: buildBody(),
    }),
  );

  renderHeader(model.name, getSubtitle(model));

  return renderTaskScoreExplorer({
    container: sectionBody("body"),
    rows: markRankedRows(toScoreRows(model.submissions ?? []), ranking),
    showModel: false,
    showRanking: true,
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
    const [model, fields, ranking] = await Promise.all([
      loadModel(modelId),
      // loadModelFields fills the Team select from /api/users/me/teams, which a signed-out
      // reader can't fetch and doesn't need: a display row renders the stored value, not an
      // option's label. loadModelMeta is the rest of it — the help text, which the display
      // rows show too, from /api/meta, which is public.
      signedIn ? loadModelFields() : loadModelMeta(),
      // Alongside the model rather than after it: it is a second read of the same record,
      // and the dashboard draws both at once.
      getModelRanking(modelId),
    ]);
    console.log(fields)
    if (!model) {
      return null;
    }

    console.log(model)

    return {
      model,
      fields,
      // Both halves. `is_mine` is team membership as the API sees it — the same rule PATCH
      // enforces, and signing in alone doesn't earn it. `signedIn` is this browser having a
      // session at all: a dev-mode API answers every request as its stub user, so without
      // this a signed-out visitor would be offered edit controls locally.
      canEdit: signedIn && model.is_mine === true,
      dashboardData: getDashboardData(model),
      ranking,
    };
  },
});