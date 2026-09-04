// Model record page — dashboard, details, submissions and scores for one model.
//
// Two of its views carry a panel under the table: the submissions compare against each other,
// and so do the task scores. Both are the same arrangement — a list of one model's rows, and a
// comparison of whichever of them are picked. The submissions' is open from the start, as the
// leaderboard's is; the scores' opens on a row and switches to a comparison on a button.

import { renderHtml } from "../core/render.js";
import { markRankedRows } from "../utils/modelUtils.js";
import { getModelRanking, loadModel, updateModel } from "../api/modelApi.js";
import {
  loadModelFields,
  loadModelMeta,
  MODEL_PANELS,
} from "../schemas/modelSchema.js";
import { loadTaskFields } from "../schemas/taskSubmissionSchema.js";
import {
  getModelBadges,
  getModelStatistics,
  getModelSubtitle,
} from "../utils/modelUtils.js";
import {
  getSubmissionFilters,
  toSubmissionRows,
} from "../utils/submissionUtils.js";
import { getTaskScoreFilters, toScoreRows } from "../utils/taskScoreUtils.js";
import {
  buildStaticSubmissionsTable,
  createSubmissionsTable,
} from "../tables/submissionTable.js";
import {
  buildStaticTaskScoresTable,
  createTaskScoresTable,
} from "../tables/taskScoreTable.js";
import { SCORE_MODES } from "../comparisons/scoreModes.js";
import { buildCreateCard } from "../cards/createCard.js";
import { buildDetailsCard } from "../cards/detailsCard.js";
import { buildRankCard } from "../cards/rankCard.js";
import { buildStatCards } from "../cards/statCards.js";
import { createSubmissionCardGrid } from "../cards/submissionCards.js";
import { createSubmissionComparison } from "../comparisons/submissionComparison.js";
import { bindTableSelection } from "../comparisons/comparison.js";
import { buildTaskScoreBars } from "../components/bars.js";
import {
  buildCompareButton,
  buildCreateButton,
  buildEditButton,
} from "../components/buttons.js";
import { buildEmptyMessage } from "../components/messages.js";
import {
  buildHeader,
  buildPage,
  buildSections,
  getSectionBody,
} from "../components/sections.js";
import {
  attachEditLink,
  renderRecordDetailsView,
} from "../templates/recordDetails.js";
import { loadRecordPage } from "../templates/recordPage.js";
import { renderRecordListView } from "../templates/recordList.js";
import { renderHeader, renderPage } from "../templates/pageChrome.js";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

const MAX_SUBMISSIONS = 3;
const MAX_SCORES = 5;

const SUMMARY_KEYS = ["team_name", "link_code", "is_pretrained", "created_at"];

const TASK_BARS_SECTION = "task-bars";

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

// The private bars only where the reader was given the private side at all — the same rule the
// rank card's chips follow, since either says something about work a stranger cannot see.
function dashboardSections(showPrivate) {
  return [
    {
      id: "stats",
      className: "stats-grid",
    },
    {
      id: "ranking",
      title: "Ranking",
    },
    ...(showPrivate
      ? [
          {
            id: TASK_BARS_SECTION,
            title: "Latest private scores",
          },
        ]
      : []),
    {
      id: "scores",
      title: "Task scores",
    },
    {
      ratio: 3,
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
}

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

function renderRankingSection(model, ranking, canEdit) {
  renderHtml(
    getSectionBody("ranking"),
    buildRankCard(ranking, {
      submitHref: canEdit ? getSubmitHref(model) : null,
    }),
  );
}

// The score each task currently stands on with the model's private work counted — the entries
// the private ranking is built from, which is what `ranked.private` marks.
function renderTaskBarsSection(rows) {
  const container = getSectionBody(TASK_BARS_SECTION);
  const latest = rows.filter((row) => row.ranked.private);

  if (!latest.length) {
    renderHtml(container, buildEmptyMessage("No private scores yet."));

    return;
  }

  renderHtml(container, buildTaskScoreBars(latest));
}

function renderScoresSection(rows) {
  const container = getSectionBody("scores");

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

function renderSubmissionsSection(model) {
  const container = getSectionBody("submissions");

  if (!model.submissions.length) {
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
      rows: toSubmissionRows(model.submissions, whoseSubmissions(model)),
      limit: MAX_SUBMISSIONS,
      viewAll: { view: "submissions" },
    }),
  );
}

function renderDashboardView(context, router) {
  const { model, fields, ranking, canEdit } = context;

  const showPrivate = Boolean(ranking?.private);

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
      body: buildSections(dashboardSections(showPrivate)),
    }),
  );

  renderHeader(model.name, getModelSubtitle(model), getModelBadges(model));

  // Once for the two sections drawn from them: the bars stand on the entries the table marks.
  const scoreRows = markRankedRows(toScoreRows(model.submissions), ranking);

  renderStatsSection(getModelStatistics(model));
  renderRankingSection(model, ranking, canEdit);
  if (showPrivate) renderTaskBarsSection(scoreRows);

  renderScoresSection(scoreRows);
  renderDetailsSection(model, fields);
  renderSubmissionsSection(model);

  if (canEdit) attachEditLink(router);
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

  if (!page) return null;

  return page.attachEditor({
    save: (draft) => updateModel(model.id, draft),
  });
}

// What the model's own detail response leaves off its nested submissions, because on that
// response it would be the same answer on every one of them — see ModelSubmissionOut. A row
// still has to say, and the comparison's details panel reads the model's name off it.
function whoseSubmissions(model) {
  return { modelName: model.name, teamName: model.team_name };
}

// ─── SUBMISSIONS VIEW ────────────────────────────────────────────────────────

function renderSubmissionsView({ model }) {
  return renderRecordListView({
    noun: "submission",
    back: BACK,
    renderTitle: () => renderHeader(model.name, getModelSubtitle(model)),
    empty: "No submissions yet.",

    rows: toSubmissionRows(model.submissions ?? [], whoseSubmissions(model)),

    createCards: () => createSubmissionCardGrid({ cardsPerPage: 8 }),

    createTable: ({ rows, selection }) =>
      createSubmissionsTable({ rows, showFilters: false, selection }),

    filterControls: getSubmissionFilters,

    // A panel underneath rather than a page of its own, which is what the submissions list
    // sends its picks to. These are one model's attempts and there are a handful of them: the
    // comparison a reader wants here is between two of the rows already in front of them, and
    // leaving the page to read it would lose the model they came for.
    //
    // `base` and no `active`, which is what puts it there from the start with no button to
    // press first — the same as the leaderboard's. A row is a pick from the moment the view
    // opens, and the panel's own prompt is what says so.
    modes: {
      base: {
        title: "Compare submissions",
        create: (container) => createSubmissionComparison({ container }),

        // `claimLinks: false`: the submission's label still goes to its own page, and a click
        // anywhere else on the row is a pick. The rows are always picking now, so they cannot
        // also be the thing that swallows the one link each carries.
        bindTable: (controller) =>
          bindTableSelection(controller, { claimLinks: false }),
      },
    },
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
    noun: "score",
    back: BACK,
    renderTitle: () => renderHeader(model.name, getModelSubtitle(model)),
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
  flags: ["edit", "created"],

  noun: "model",

  // A model page is readable by anyone — see GET /api/models/{id}, which withholds the
  // team-only fields rather than the whole record.
  requiresAuth: false,

  load: async (modelId, { signedIn }) => {
    // `loadTaskFields` costs no second request and fills the methodology fields' options in
    // place from the server's own enums, which is where the score filters read them from.
    // Caught rather than allowed to reject: it fails only when /api/meta does, and the two
    // beside it are already reporting that.
    const [model, fields, ranking] = await Promise.all([
      loadModel(modelId),
      signedIn ? loadModelFields() : loadModelMeta(),
      getModelRanking(modelId),
      loadTaskFields().catch(() => undefined),
    ]);

    if (!model) {
      return null;
    }

    return {
      model,
      fields,
      ranking,
      // `signedIn` as well as `is_mine`: a dev-mode API answers every request as its stub user.
      canEdit: signedIn && model.is_mine === true,
    };
  },
});
