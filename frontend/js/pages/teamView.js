// Team record page — dashboard and details for one team.

import { renderHtml } from "../core/render.js";
import { escapeHtml } from "../core/html.js";
import {
  buildEmptyMessage,
  buildFailureMessage,
  buildInfoMessage,
} from "../components/messages.js";
import {
  buildCreateButton,
  buildEditButton,
  buildMembersButton,
} from "../components/buttons.js";
import { buildTableCount } from "../components/count.js";
import {
  attachEditLink,
  renderRecordDetailsView,
} from "../templates/recordDetails.js";
import { TEAM_FIELDS, TEAM_PANELS } from "../schemas/teamSchema.js";
import { loadTeam, updateTeam } from "../api/teamApi.js";
import {
  getTeamStatistics,
  getTeamSubtitle,
  isTeamOwner,
} from "../utils/teamUtils.js";
import { getModels } from "../api/modelApi.js";
import { toModelRows } from "../utils/modelUtils.js";
import { buildStaticModelsTable } from "../tables/modelTable.js";
import {
  buildMembersPanel,
  createMembersSection,
} from "../widgets/teamMembers.js";

import { buildStatCards } from "../cards/statCards.js";
import { buildCreateCard } from "../cards/createCard.js";
import { buildRoleBadge } from "../components/badges.js";
import { loadRecordPage } from "../templates/recordPage.js";
import {
  renderPage,
  renderHeader,
  renderMessage,
  clearMessage,
} from "../templates/pageChrome.js";
import {
  buildHeader,
  buildPage,
  buildSections,
  getSectionBody,
} from "../components/sections.js";

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

// Models first: it is what a visitor came for, and the only section a non-member sees.
//
// No "view all" link on it, deliberately: the models list is every team's, and pointing a
// team page at it would quietly change what the reader is looking at.
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

function buildMemberRow(member) {
  return `
    <tr>
      <td>${escapeHtml(member.name || "—")}</td>
      <td>${escapeHtml(member.email)}</td>
      <td>${buildRoleBadge(member.role)}</td>
    </tr>
  `;
}

function buildMemberTable(members) {
  return `
    <div class="table">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
          </tr>
        </thead>
        <tbody>
          ${members.map(buildMemberRow).join("")}
        </tbody>
      </table>
      <div class="table-footer">${buildTableCount(members.length, members.length, "member")}</div>
    </div>
  `;
}

function renderStatsSection(statistics) {
  renderHtml(getSectionBody("stats"), buildStatCards(statistics));
}

// No Team column: every row is this team's, which the page's own heading already says.
// The card stands in for the table, and the heading keeps its button: a team with no
// models is the state the page most wants to move the reader out of.
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

    // A reader who may not edit gets no members block: it would report an empty team rather
    // than an unreadable one, and every write it offers would 403.
    sections: canEdit ? [MEMBERS_SECTION_BODY] : [],

    createCard: {
      href: CREATE_MODEL_HREF,
      label: "Register your first model for this team",
    },

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
  noun: "team",
  flags: ["edit", "created"],

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

    // Both halves, as on the model and submission pages: `is_mine` is team membership as
    // the API sees it, `signedIn` is this browser having a session at all.
    return {
      team,
      models,
      fields: TEAM_FIELDS,
      canEdit: signedIn && team.is_mine === true,
    };
  },
});
