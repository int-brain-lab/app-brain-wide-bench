// Model record page — dashboard, details, submissions and scores for one model.
//
// Two of its views carry a panel under the table: the submissions compare against each other,
// and so do the task scores. Both are the same arrangement — a list of one model's rows, and a
// comparison of whichever of them are picked. The submissions' is open from the start, as the
// leaderboard's is; the scores' opens on a row and switches to a comparison on a button.

import { renderHtml } from "../core/render.js";
import { markRankedRows } from "../utils/modelUtils.js";
import { deleteModel, getModelRanking, loadModel, updateModel } from "../api/modelApi.js";
import { loadModelFields, loadModelMeta, MODEL_PANELS } from "../schemas/modelSchema.js";
import { fieldsForPanel } from "../schemas/schemaPanels.js";
import { loadTaskFields } from "../schemas/taskSubmissionSchema.js";
import { getModelDeleteItems } from "../utils/deleteUtils.js";
import { getModelBadges, getModelSubtitle, hasPrivateOnlyScores } from "../utils/modelUtils.js";
import { getSubmissionFilters, toSubmissionRows } from "../utils/submissionUtils.js";
import { getTaskScoreFilters, toScoreRows } from "../utils/taskScoreUtils.js";
import { dateSorter } from "../tables/formatters.js";
import { createSubmissionsTable } from "../tables/submissionTable.js";
import { previewRows } from "../tables/table.js";
import { buildLatestScoresTable, createTaskScoresTable } from "../tables/taskScoreTable.js";
import { SCORE_PANEL } from "../comparisons/taskScoreComparison.js";
import { buildCreateCard } from "../cards/createCard.js";
import { buildDetailsCard } from "../cards/detailsCard.js";
import { buildRankCard } from "../cards/rankCard.js";
import { buildSubmissionCards, createSubmissionCardGrid } from "../cards/submissionCards.js";
import { createSubmissionComparison } from "../comparisons/submissionComparison.js";
import {
  buildCompareButton,
  buildCreateButton,
  buildDetailsButton,
  buildViewAllButton,
  EDIT_DETAILS_BUTTON,
} from "../components/buttons.js";
import {
  buildHeader,
  buildPage,
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

// Two, because that is what `.card-stack` splits a column into.
const MAX_SUBMISSIONS = 2;

// The render functions are declarations, so they are defined by the time this is read.
const VIEWS = {
  dashboard: renderDashboardView,
  details: renderDetailsView,
  submissions: renderSubmissionsView,
  scores: renderScoresView,
};

// Where each section's "view all" goes, by the id of the section it closes. The button
// itself is built at render — see buildFooter — because the number it names is data.
const VIEW_ALL = {
  submissions: { noun: "submission", view: "submissions" },
  scores: { noun: "score", view: "scores" },
};

// Where a deleted model leaves the reader.
const MODEL_LIST_HREF = "/html/models/model_list.html";

// The record's own fields have no count to name: the button opens one page, not a list.
const DETAILS_BUTTON = buildDetailsButton({ view: "details" });

const DETAILS_FOOTER = buildSectionFooter(DETAILS_BUTTON);

// Ranking has nothing to open, but it shares a row with two sections that do, and its card
// would run to the bottom of the row while theirs stop above their buttons. The same footer,
// holding its space and nothing else — see buildSectionFooter's `hidden`.
const RANKING_FOOTER = buildSectionFooter(DETAILS_BUTTON, { hidden: true });

function dashboardSections() {
  return [
    {
      ratio: "1-2-2",
      sections: [
        { id: "ranking", title: "Ranking" },
        { id: "details", title: "Details" },
        { id: "submissions", title: "Recent submissions" },
      ],
    },
    {
      id: "scores",
      title: "Latest scores",
      description:
        "The newest score for each task, and where it places against the models scored on that task.",
    },
  ];
}

// The way from a section's preview to the whole of it, under the content — see
// buildSectionFooter.
function buildFooter(id, count) {
  const { noun, ...target } = VIEW_ALL[id];

  return buildSectionFooter(buildViewAllButton(noun, target, { count }));
}

// What the section shows, with the way to the rest of it underneath. Only for a section
// that has something: the create card an empty one shows is already the way on from there.
function renderSection(id, content, footer) {
  renderHtml(getSectionBody(id), content + footer, { refresh: true });
}

// ─── LINKS ───────────────────────────────────────────────────────────────────

function getCompareHref(model) {
  return `/html/models/compare.html?id=${encodeURIComponent(model.id)}`;
}

function getSubmitHref(model) {
  return `/html/submissions/submission_create.html?model=${encodeURIComponent(model.id)}`;
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────

function renderRankingSection(ranking, showPrivate) {
  renderSection("ranking", buildRankCard(ranking, { showPrivate }), RANKING_FOOTER);
}

// Where the model stands today: one entry per task, private runs counted for a reader given
// them. The rest of the rows are superseded scores, behind the "view all".
function renderScoresSection(rows) {
  const latest = rows.filter((row) => row.ranked.latest);

  // Hidden rather than emptied: the stats above already say nothing has been scored, and a
  // heading over a message would say it twice.
  if (!latest.length) {
    getSection("scores").hidden = true;
    return;
  }

  // Every one of them, not a preview: a model stands on one entry per task, so there are at
  // most as many rows as the benchmark has tasks. The button is still the way to the scores
  // these superseded, and to the filters and the comparison over them.
  renderSection(
    "scores",
    buildLatestScoresTable({ rows: latest }),
    buildFooter("scores", rows.length),
  );
}

// The keys come off the schema's own panel rather than a list here, so a link added to
// MODEL_PANELS.links is a row on this card.
function renderDetailsSection(model, fields) {
  renderSection(
    "details",
    buildDetailsCard({
      record: model,
      fields,
      keys: fieldsForPanel(fields, "links"),
    }),
    DETAILS_FOOTER,
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

  // Newest first, as the table behind the "view all" orders them. Stacked and sized by
  // `.card-stack`, as the user dashboard's are.
  const recent = previewRows(
    toSubmissionRows(model.submissions, whoseSubmissions(model)),
    (a, b) => dateSorter(b.updated_at, a.updated_at),
    MAX_SUBMISSIONS,
  );

  // The footer goes inside the stack rather than after it, so it takes the row under the
  // last card: a stack of one puts its empty half below the button rather than above it.
  renderHtml(
    container,
    `<div class="card-stack">
      ${buildSubmissionCards(recent)}
      ${buildFooter("submissions", model.submissions.length)}
    </div>`,
    { refresh: true },
  );
}

function renderDashboardView(context, router) {
  const { model, fields, ranking, canEdit } = context;

  // Before the page is built: the sections it holds depend on what the scores say.
  const scoreRows = markRankedRows(toScoreRows(model.submissions), ranking);

  // Nothing held back means the public ranking is the only one there is to report, and the
  // private column would repeat the public one down the card.
  const heldBack = hasPrivateOnlyScores(scoreRows);

  // `primary-inv` as every other Compare is — the leaderboard's and the lists' — so the one
  // button that opens a comparison is one colour wherever it is offered.
  const compare = buildCompareButton({
    href: getCompareHref(model),
    className: "primary-inv",
  });

  const actions = canEdit
    ? [
        [
          EDIT_DETAILS_BUTTON,
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
      body: buildSections(dashboardSections()),
    }),
  );

  renderHeader(model.name, getModelSubtitle(model), getModelBadges(model));

  renderRankingSection(ranking, heldBack);

  renderScoresSection(scoreRows);
  renderDetailsSection(model, fields);
  renderSubmissionsSection(model);

}

// ─── DETAILS VIEW ────────────────────────────────────────────────────────────

function renderDetailsView({ model, fields, canEdit, edit, created }) {
  const page = renderRecordDetailsView({
    noun: "model",
    record: model,
    fields,
    panels: MODEL_PANELS,
    canEdit,
    edit,
    created,

    createdNext: {
      detail: "Go to the model dashboard, or make your first submission for this model.",
      href: getSubmitHref(model),
      label: "New submission",
    },

    dashboard: true,

    // Any member may delete a model, which is the rule that gates editing it.
    deletable: true,

    renderTitle: (shown) => renderHeader(shown.name, getModelSubtitle(shown)),
  });

  if (!page) return null;

  createDeleteControl({
    noun: "model",
    name: () => model.name,
    items: () => getModelDeleteItems(model),
    remove: () => deleteModel(model.id),
    onDeleted: () => window.location.assign(MODEL_LIST_HREF),
  }).attach();

  return page.attachEditor({ save: (draft) => updateModel(model.id, draft) });
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
    panel: {
      title: "Compare submissions",
      create: (container) => createSubmissionComparison({ container }),
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

    panel: SCORE_PANEL,
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

  // Their own model sits inside the app, with the sidebar; anyone else's is a public page
  // and keeps the top nav.
  privateShell: (context) => context.canEdit,

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
