// Team record page — dashboard and details for one team.

import { renderHtml } from "../core/render.js";
import { getModels } from "../api/modelApi.js";
import { loadTeam, updateTeam } from "../api/teamApi.js";
import { TEAM_FIELDS, TEAM_PANELS } from "../schemas/teamSchema.js";
import { toModelRows } from "../utils/modelUtils.js";
import {
  getTeamStatistics,
  getTeamSubtitle,
  isTeamOwner,
} from "../utils/teamUtils.js";
import { buildStaticModelsTable } from "../tables/modelTable.js";
import { buildCreateCard } from "../cards/createCard.js";
import { buildStatCards } from "../cards/statCards.js";
import {
  buildCreateButton,
  buildEditButton,
  buildMembersButton,
} from "../components/buttons.js";
import {
  buildEmptyMessage,
  buildFailureMessage,
  buildInfoMessage,
} from "../components/messages.js";
import {
  buildHeader,
  buildPage,
  buildSections,
  getSectionBody,
} from "../components/sections.js";
import {
  buildMemberTable,
  buildMembersPanel,
  createMembersSection,
} from "../widgets/teamMembers.js";
import {
  attachEditLink,
  renderRecordDetailsView,
} from "../templates/recordDetails.js";
import { loadRecordPage } from "../templates/recordPage.js";
import {
  clearMessage,
  renderHeader,
  renderMessage,
  renderPage,
} from "../templates/pageChrome.js";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

const MAX_MODELS = 5;

const BACK = {
  text: "← Back to dashboard",
  view: "dashboard",
};

// The render functions are declarations, so they are defined by the time this is read.
const VIEWS = {
  dashboard: renderDashboardView,
  details: renderDetailsView,
};

const MODELS_SECTION = {
  id: "models",
  title: "Models",
};

const DASHBOARD_SECTIONS = [
  {
    id: "stats",
    className: "stats-grid",
  },
  MODELS_SECTION,
  {
    id: "members",
    title: "Members",
    actions: [buildMembersButton({ view: "details" })],
  },
];

// The same section without the link: the details view is where "Manage members" leads.
const MEMBERS_SECTION_BODY = {
  id: "members",
  title: "Members",
};

// ─── LINKS ───────────────────────────────────────────────────────────────────

const CREATE_MODEL_HREF = "/html/models/model_create.html";

// ─── DASHBOARD ───────────────────────────────────────────────────────────────

function renderStatsSection(statistics) {
  renderHtml(getSectionBody("stats"), buildStatCards(statistics));
}

function renderModelsSection(models) {
  const container = getSectionBody("models");

  if (!models.length) {
    renderHtml(
      container,
      buildCreateCard({
        href: CREATE_MODEL_HREF,
        label: "Create your first model",
      }),
      { refresh: true },
    );

    return;
  }

  renderHtml(
    container,
    buildStaticModelsTable({
      rows: toModelRows(models),
      // No Team column: every row is this team's.
      showTeam: false,
      limit: MAX_MODELS,
    }),
  );
}

// Only reached for a member — the section itself isn't built for anyone else, since the
// API withholds the list and a block saying so is noise on a public page.
function renderMembersSection(team) {
  const container = getSectionBody("members");

  if (!team.members.length) {
    renderHtml(container, buildEmptyMessage("No members yet."));
    return;
  }

  renderHtml(container, buildMemberTable(team.members));
}

function renderDashboardView(context, router) {
  const { team, models, canEdit } = context;

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
      body: buildSections(canEdit ? DASHBOARD_SECTIONS : [MODELS_SECTION]),
    }),
  );

  renderHeader(team.name, getTeamSubtitle(team));

  renderStatsSection(getTeamStatistics(team));
  renderModelsSection(models);

  if (!canEdit) return;

  renderMembersSection(team);

  attachEditLink(router);

  // Manage members means the same thing as Edit, so it opens the editor too. Without
  // stopPropagation the router's own delegated handler would also see this click and
  // navigate a second time, landing read-only.
  document
    .querySelector("[data-view='details']")
    .addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      router.goTo("details", { edit: true });
    });
}

// ─── DETAILS VIEW ────────────────────────────────────────────────────────────

function renderDetailsView({ team, fields, canEdit, edit, created }) {
  const page = renderRecordDetailsView({
    noun: "team",
    record: team,
    fields,
    panels: TEAM_PANELS,
    back: BACK,
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

  load: async (teamId, { signedIn }) => {
    const [team, models] = await Promise.all([
      loadTeam(teamId),
      // Scoped server-side rather than filtered here: the endpoint decides what this caller
      // may see, which is the whole point on a page a stranger can open.
      getModels(teamId),
    ]);

    if (!team) {
      return null;
    }

    // `signedIn` as well as `is_mine`: a dev-mode API answers every request as its stub user.
    return {
      team,
      models,
      fields: TEAM_FIELDS,
      canEdit: signedIn && team.is_mine === true,
    };
  },
});
