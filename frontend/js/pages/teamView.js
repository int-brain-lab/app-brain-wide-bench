// Team record page — dashboard and details for one team.

import { renderHtml } from "../core/render.js";
import { getModels } from "../api/modelApi.js";
import { getSubmissions } from "../api/submissionApi.js";
import { getTaskSubmissions } from "../api/taskSubmissionApi.js";
import { loadTeam, updateTeam } from "../api/teamApi.js";
import { loadTaskFields } from "../schemas/taskSubmissionSchema.js";
import { TEAM_FIELDS, TEAM_PANELS } from "../schemas/teamSchema.js";
import { toModelRows } from "../utils/modelUtils.js";
import { toSubmissionRows } from "../utils/submissionUtils.js";
import {
  getCoverageBadges,
  getTaskScoreFilters,
  toBestScoreRows,
  toScoreResultRows,
} from "../utils/taskScoreUtils.js";
import { getTeamSubtitle, isTeamOwner } from "../utils/teamUtils.js";
import { dateSorter } from "../tables/formatters.js";
import { buildBestScoresTable, createTaskScoresTable } from "../tables/taskScoreTable.js";
import { previewRows } from "../tables/table.js";
import { SCORE_PANEL } from "../comparisons/taskScoreComparison.js";
import { buildCreateCard } from "../cards/createCard.js";
import { buildModelCards } from "../cards/modelCards.js";
import { buildSubmissionCards } from "../cards/submissionCards.js";
import {
  buildCreateButton,
  buildEditButton,
  buildMembersButton,
  buildViewAllButton,
} from "../components/buttons.js";
import { buildCount } from "../components/count.js";
import {
  buildEmptyMessage,
  buildFailureMessage,
  buildInfoMessage,
} from "../components/messages.js";
import {
  buildHeader,
  buildPage,
  buildSectionFooter,
  buildSections,
  getSection,
  getSectionBody,
} from "../components/sections.js";
import {
  buildMemberTable,
  buildMembersPanel,
  createMembersSection,
} from "../widgets/teamMembers.js";
import { attachEditLink, renderRecordDetailsView } from "../templates/recordDetails.js";
import { loadRecordPage } from "../templates/recordPage.js";
import { renderRecordListView } from "../templates/recordList.js";
import { clearMessage, renderHeader, renderMessage, renderPage } from "../templates/pageChrome.js";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

// The same for both: they sit side by side, and a row of lists of different lengths reads
// as one of them having run out.
const MAX_CARDS = 2;

// The render functions are declarations, so they are defined by the time this is read.
const VIEWS = {
  dashboard: renderDashboardView,
  details: renderDetailsView,
  scores: renderScoresView,
};

// ─── LINKS ───────────────────────────────────────────────────────────────────

const CREATE_MODEL_HREF = "/html/models/model_create.html";

// Where the cards' "view all" goes. Not scoped to this team — there is no team-scoped
// listing page — but both lists carry a Team filter, which is the nearest thing to one.
const MODELS_LIST_HREF = "/html/models/model_list.html";
const SUBMISSIONS_LIST_HREF = "/html/submissions/submission_list.html";

// What an empty section offers a member in place of its cards.
const CREATE_MODEL = {
  href: CREATE_MODEL_HREF,
  card: "Register the first model for this team",
};

const CREATE_SUBMISSION = {
  href: "/html/submissions/submission_create.html",
  card: "Make the first submission for this team",
};

// ─── SECTIONS ────────────────────────────────────────────────────────────────

// The way from each section's preview to the whole of it, by the id of the section it
// closes. Under the content rather than beside the heading — see buildSectionFooter.
const VIEW_ALL = {
  models: { noun: "model", href: MODELS_LIST_HREF },
  submissions: { noun: "submission", href: SUBMISSIONS_LIST_HREF },
  scores: { noun: "score", view: "scores" },
};

const MEMBERS_SECTION = {
  id: "members",
  title: "Members",
  actions: [buildMembersButton({ view: "details" })],
};

// The same section without the link: the details view is where "Manage members" leads.
const MEMBERS_SECTION_BODY = {
  id: "members",
  title: "Members",
};

/**
 * Who the team is, then what it has entered, then how it has done — the same reading order
 * as the account's own dashboard, which this is the team-sized version of.
 *
 * The members table only for a member: the API withholds the list, so for anyone else the
 * section would report an empty team rather than an unreadable one.
 */
function dashboardSections(canEdit) {
  return [
    ...(canEdit ? [MEMBERS_SECTION] : []),
    {
      // Equal columns: both hold the same card, so neither earns more room. What the team
      // holds is said once in the page's own header, not in cards over these.
      sections: [
        { id: "models", title: "Models" },
        { id: "submissions", title: "Submissions" },
      ],
    },
    {
      id: "scores",
      title: "Best scores",
      description:
        "The best this team has scored on each task, across every model and submission of theirs.",
    },
  ];
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────

// A section with nothing in it says what it is for in the words of the thing that would
// fill it — but only to someone who could fill it. A visitor gets the plain sentence.
function renderEmptySection(id, empty, create) {
  renderHtml(
    getSectionBody(id),
    create ? buildCreateCard({ href: create.href, label: create.card }) : buildEmptyMessage(empty),
    { refresh: true },
  );
}

// The way from a section's preview to the whole of it, under the content — see
// buildSectionFooter. Built at render rather than beside the sections above, because the
// number it names is data.
function buildFooter(id, count) {
  const { noun, ...target } = VIEW_ALL[id];

  return buildSectionFooter(buildViewAllButton(noun, target, { count }));
}

// What the section shows, with the way to the rest of it underneath. Only for a section
// that has something: the create card an empty one shows is already the way on from there.
function renderSection(id, content, count) {
  renderHtml(getSectionBody(id), content + buildFooter(id, count), {
    refresh: true,
  });
}

// Stacked in what the section is given, every card the same size — see `.card-stack`.
//
// The footer goes inside the stack rather than after it, so it takes the row under the last
// card: a stack of one puts its empty half below the button rather than above it.
function renderCards(id, cards, count) {
  renderHtml(
    getSectionBody(id),
    `<div class="card-stack">${cards}${buildFooter(id, count)}</div>`,
    { refresh: true },
  );
}

function renderModelsSection(models, canEdit) {
  if (!models.length) {
    renderEmptySection("models", "No models yet.", canEdit && CREATE_MODEL);
    return;
  }

  // Newest first, as the list behind the "view all" orders them.
  const recent = previewRows(
    toModelRows(models),
    (a, b) => dateSorter(b.created_at, a.created_at),
    MAX_CARDS,
  );

  // No team on the cards: every one of them is this team's.
  renderCards("models", buildModelCards(recent, { showTeam: false }), models.length);
}

function renderSubmissionsSection(submissions, canEdit) {
  if (!submissions.length) {
    renderEmptySection("submissions", "No submissions yet.", canEdit && CREATE_SUBMISSION);
    return;
  }

  const recent = previewRows(
    toSubmissionRows(submissions),
    (a, b) => dateSorter(b.updated_at, a.updated_at),
    MAX_CARDS,
  );

  renderCards("submissions", buildSubmissionCards(recent, { showTeam: false }), submissions.length);
}

function renderScoresSection(scoreRows) {
  const best = toBestScoreRows(scoreRows);

  if (!best.length) {
    getSection("scores").hidden = true;
    return;
  }

  // Every one of them, not a preview: there is one row per task the team has scored, so at
  // most as many as the benchmark has tasks. The link is the way to the rest of the scores
  // behind each best, and to the filters and the comparison over them.
  renderSection(
    "scores",
    buildBestScoresTable({ rows: best, total: scoreRows.length }),
    scoreRows.length,
  );
}

// Only reached for a member — the section itself isn't built for anyone else.
function renderMembersSection(team) {
  const container = getSectionBody("members");

  if (!team.members.length) {
    renderHtml(container, buildEmptyMessage("No members yet."));
    return;
  }

  renderHtml(container, buildMemberTable(team.members));
}

function renderDashboardView(context, router) {
  const { team, models, submissions, scoreRows, canEdit } = context;

  renderPage(
    buildPage({
      header: buildHeader(
        canEdit
          ? [
              buildEditButton(),
              buildCreateButton({
                href: CREATE_MODEL_HREF,
                label: "New model",
              }),
            ]
          : [],
      ),
      body: buildSections(dashboardSections(canEdit)),
    }),
  );

  renderHeader(team.name, getTeamSubtitle(team), getCoverageBadges(scoreRows));

  renderModelsSection(models, canEdit);
  renderSubmissionsSection(submissions, canEdit);
  renderScoresSection(scoreRows);

  if (!canEdit) return;

  renderMembersSection(team);

  attachEditLink(router);

  // Manage members means the same thing as Edit, so it opens the editor too. Without
  // stopPropagation the router's own delegated handler would also see this click and
  // navigate a second time, landing read-only.
  document.querySelector("[data-view='details']").addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    router.goTo("details", { edit: true });
  });
}

// ─── SCORES VIEW ─────────────────────────────────────────────────────────────

function renderScoresView({ team, models, scoreRows }) {
  const display = { showModel: true, showSubmission: true };

  return renderRecordListView({
    noun: "score",
    renderTitle: () =>
      renderHeader(
        team.name,
        `${buildCount(scoreRows.length, "task")} across ${buildCount(models.length, "model")}`,
      ),
    empty: "No scored tasks yet.",

    rows: scoreRows,

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

// ─── DETAILS VIEW ────────────────────────────────────────────────────────────

function renderDetailsView({ team, fields, canEdit, edit, created }) {
  const page = renderRecordDetailsView({
    noun: "team",
    record: team,
    fields,
    panels: TEAM_PANELS,
    canEdit,
    edit,
    created,

    createCard: {
      href: CREATE_MODEL_HREF,
      label: "Register your first model for this team",
    },

    // A reader who may not edit gets no members block: it would report an empty team rather
    // than an unreadable one, and every write it offers would 403.
    sections: canEdit ? [MEMBERS_SECTION_BODY] : [],

    renderTitle: (shown) => renderHeader(shown.name, getTeamSubtitle(shown)),
  });

  if (!page) return null;

  // Built between the shell and the editor: the section it draws into exists by now, and
  // the hooks below have to be live before `edit` opens the editor by itself.
  renderHtml(getSectionBody("members"), buildMembersPanel());

  const members = createMembersSection({
    getTeam: () => team,
    onMessage: (message, failed) => {
      if (!message) {
        clearMessage();
      } else if (failed) {
        renderMessage(buildFailureMessage(message));
      } else {
        renderMessage(buildInfoMessage(message));
      }
    },
  });

  members.render();

  // Set by `save`, read by `onSaved`: the editor's save must return the one record it
  // merges, so per-member failures have no way through except a variable scoped to here.
  let failedMembers = [];

  return page.attachEditor({
    onEdit: () => members.setEditing(isTeamOwner(team)),

    // Members first, then the rename: PATCH answers with the full TeamDetail, so doing it
    // last means the response already reflects the membership changes.
    save: async (draft) => {
      failedMembers = await members.apply();

      return updateTeam(team.id, draft);
    },

    onSaved: () => {
      members.setEditing(false);
      members.render();

      // attachRecordEditor has already reported the save; this overwrites it only when the
      // rename went through but a member didn't, which the standard card cannot say.
      if (failedMembers.length) {
        renderMessage(
          buildFailureMessage(
            "Team saved, but some members could not be changed.",
            new Error(failedMembers.join("; ")),
          ),
        );
      }

      failedMembers = [];
    },

    onCancel: () => {
      members.reset();
      members.setEditing(false);
    },
  });
}

// ─── LOAD ────────────────────────────────────────────────────────────────────

loadRecordPage({
  views: VIEWS,
  flags: ["edit", "created"],

  noun: "team",

  // A team page is readable by anyone — see GET /api/teams/{id}, which withholds the
  // member list rather than the whole record.
  requiresAuth: false,

  // Score rows are built once here, not per view — both the dashboard and the scores view
  // render the same rows, and the scores view is reached without a reload.
  load: async (teamId, { signedIn }) => {
    // All three listings are scoped server-side: the endpoint decides what this caller may
    // see, which is the whole point on a page a stranger can open.
    //
    // `loadTaskFields` fills the methodology fields' options in place from the server's own
    // enums, which is where the score filters read them from. Caught rather than allowed to
    // reject: a failing /api/meta then costs those filters their options rather than the
    // page its panels.
    const [team, models, submissions, taskSubmissions] = await Promise.all([
      loadTeam(teamId),
      getModels(teamId),
      getSubmissions(teamId),
      getTaskSubmissions(teamId),
      loadTaskFields().catch(() => undefined),
    ]);

    if (!team) {
      return null;
    }

    // `signedIn` as well as `is_mine`: a dev-mode API answers every request as its stub user.
    return {
      team,
      models,
      submissions: submissions ?? [],
      scoreRows: toScoreResultRows(taskSubmissions ?? []),
      fields: TEAM_FIELDS,
      canEdit: signedIn && team.is_mine === true,
    };
  },
});
