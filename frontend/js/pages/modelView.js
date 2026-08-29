// Model record page — dashboard, details, submissions and scores for one model.

import { buildRankCard } from "../cards/rankCard.js";
import { buildCreateCard } from "../cards/createCard.js";
import { buildDetailsCard } from "../cards/detailsCard.js";
import { buildStatCards } from "../cards/statCards.js";
import { createSubmissionCardGrid } from "../cards/submissionCards.js";
import {
  buildCompareButton,
  buildCreateButton,
  buildEditButton,
} from "../components/buttons.js";
import { getSubmissionFilters } from "../utils/submissionUtils.js";
import { getTaskScoreFilters } from "../utils/taskScoreUtils.js";
import { renderHtml } from "../core/render.js";
import { buildEmptyMessage } from "../components/messages.js";
import { markRankedRows } from "../core/rankData.js";
import {
  createSubmissionsTable,
  buildStaticSubmissionsTable,
} from "../tables/submissionTable.js";
import {
  createTaskScoresTable,
  buildStaticTaskScoresTable,
} from "../tables/taskScoreTable.js";
import { getModelRanking, loadModel, updateModel } from "../api/modelApi.js";
import {
  loadModelFields,
  loadModelMeta,
  MODEL_PANELS,
} from "../schemas/modelSchema.js";
import {
  attachEditLink,
  renderRecordDetailsView,
} from "../templates/recordDetails.js";

import { loadRecordPage } from "../templates/recordPage.js";
import { renderRecordListView } from "../templates/recordList.js";
import { renderHeader, renderPage } from "../templates/pageChrome.js";
import {
  buildSections,
  getSectionBody,
  buildHeader,
  buildPage,
} from "../components/sections.js";
import { SCORE_MODES, toScoreRows } from "../utils/taskScoreUtils.js";
import {
  getModelBadges,
  getModelStatistics,
  getModelSubtitle,
} from "../utils/modelUtils.js";
import { toSubmissionRows } from "../utils/submissionUtils.js";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

const MAX_SUBMISSIONS = 3;
const MAX_SCORES = 5;

const SUMMARY_KEYS = ["team_name", "link_code", "is_pretrained", "created_at"];

const BACK = {
  text: "← Back to dashboard",
  view: "dashboard",
};

// The render functions are declarations, so they are defined by the time this is read.
const VIEWS = {
  dashboard: renderDashboardView,
  details: renderDetailsView,
  submissions: renderSubmissionsView,
  scores: renderScoresView,
};

const DASHBOARD_SECTIONS = [
  {
    id: "stats",
    className: "stats-grid",
  },
  {
    id: "ranking",
    title: "Ranking",
  },
  {
    id: "scores",
    title: "Task scores",
  },
  {
    uneven: true,
    sections: [
      {
        id: "details",
        title: "Model details",
      },
      {
        id: "submissions",
        title: "Recent submissions",
      },
    ],
  },
];

// ─── LINKS ───────────────────────────────────────────────────────────────────

function getCompareHref(model) {
  return `/html/models/compare.html?id=${encodeURIComponent(model.id)}`;
}

function getSubmitHref(model) {
  return `/html/submissions/submission_create.html?model=${encodeURIComponent(model.id)}`;
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────

function renderStatsSection(statistics) {
  renderHtml(getSectionBody("stats"), buildStatCards(statistics));
}

function renderRankingSection(ranking, model, canEdit) {
  renderHtml(
    getSectionBody("ranking"),
    buildRankCard(ranking, {
      submitHref: canEdit ? getSubmitHref(model) : null,
    }),
  );
}

function renderScoresSection(submissions, ranking) {
  const container = getSectionBody("scores");
  const rows = markRankedRows(toScoreRows(submissions), ranking);

  if (!rows.length) {
    renderHtml(container, buildEmptyMessage("No scores yet."));
    return;
  }

  renderHtml(
    container,
    buildStaticTaskScoresTable({
      rows,
      showSubmission: false,
      showRanking: true,
      limit: MAX_SCORES,
      viewAll: { view: "scores" },
    }),
  );
}

function renderDetailsSection(model, fields) {
  renderHtml(
    getSectionBody("details"),
    buildDetailsCard({ record: model, fields, keys: SUMMARY_KEYS }),
  );
}

// The card stands in for the table, and the heading keeps its button: a model with no
// submissions is the state the page most wants to move the reader out of.
function renderSubmissionsSection(model, submissions) {
  const container = getSectionBody("submissions");

  if (!submissions.length) {
    renderHtml(
      container,
      buildCreateCard({
        href: getSubmitHref(model),
        label: "Create your first submission",
      }),
      { refresh: true },
    );

    return;
  }

  renderHtml(
    container,
    buildStaticSubmissionsTable({
      rows: toSubmissionRows(submissions),
      limit: MAX_SUBMISSIONS,
      viewAll: { view: "submissions" },
    }),
  );
}

function renderDashboardView(context, router) {
  const { model, fields, ranking, canEdit } = context;
  const statistics = getModelStatistics(model);

  const compare = buildCompareButton({
    href: getCompareHref(model),
    className: "primary",
  });

  const actions = canEdit
    ? [
        [
          buildEditButton(),
          buildCreateButton({
            href: getSubmitHref(model),
            label: "New submission",
          }),
        ],
        [compare],
      ]
    : [compare];

  renderPage(
    buildPage({
      header: buildHeader(actions),
      body: buildSections(DASHBOARD_SECTIONS),
    }),
  );

  renderHeader(model.name, getModelSubtitle(model), getModelBadges(model));

  renderStatsSection(statistics);
  renderRankingSection(ranking, model, canEdit);
  renderScoresSection(model.submissions, ranking);
  renderDetailsSection(model, fields);
  renderSubmissionsSection(model, model.submissions);

  if (canEdit) {
    attachEditLink(router);
  }
}

// ─── DETAILS VIEW ────────────────────────────────────────────────────────────

function renderDetailsView({ model, fields, canEdit, edit, created }) {
  const page = renderRecordDetailsView({
    noun: "model",
    record: model,
    fields,
    panels: MODEL_PANELS,
    back: BACK,
    canEdit,
    edit,
    created,

    createCard: {
      href: getSubmitHref(model),
      label: "Make your first submission for this model",
    },

    renderTitle: (shown) => renderHeader(shown.name, getModelSubtitle(shown)),
  });

  return page?.attachEditor({
    save: (draft) => updateModel(model.id, draft),
  });
}

// ─── SUBMISSIONS VIEW ────────────────────────────────────────────────────────

function renderSubmissionsView({ model }) {
  return renderRecordListView({
    back: BACK,
    renderTitle: () => renderHeader(model.name, getModelSubtitle(model)),
    noun: "submission",
    empty: "No submissions yet.",

    rows: toSubmissionRows(model.submissions ?? []),

    createCards: () => createSubmissionCardGrid({ cardsPerPage: 8 }),

    createTable: ({ rows }) =>
      createSubmissionsTable({ rows, showFilters: false }),

    filterControls: getSubmissionFilters,
  });
}

// ─── SCORES VIEW ─────────────────────────────────────────────────────────────

function renderScoresView({ model, ranking }) {
  const display = {
    showModel: false,
    showRanking: true,
    showSubmission: true,
  };

  return renderRecordListView({
    back: BACK,
    renderTitle: () => renderHeader(model.name, getModelSubtitle(model)),
    noun: "score",
    empty: "No scored tasks yet.",

    rows: markRankedRows(toScoreRows(model.submissions ?? []), ranking),

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
  noun: "model",
  flags: ["edit", "created"],

  // A model with a public submission is readable by anyone.
  requiresAuth: false,

  load: async (modelId, { signedIn }) => {
    const [model, fields, ranking] = await Promise.all([
      loadModel(modelId),
      signedIn ? loadModelFields() : loadModelMeta(),
      getModelRanking(modelId),
    ]);

    if (!model) {
      return null;
    }

    return {
      model,
      fields,
      ranking,
      canEdit: signedIn && model.is_mine === true,
    };
  },
});
