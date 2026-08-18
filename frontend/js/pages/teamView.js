// Team record page — dashboard and details for one team.

import { escapeHtml, showEmpty, showFailure, showMessage, showSuccess } from "../core/utils.js";
import { attachEditLink, attachRecordEditor } from "../templates/record-editor.js";
import { TEAM_FIELDS, TEAM_PANELS } from "../schemas/teamSchema.js";
import { loadTeam, updateTeam } from "../api/teamApi.js";
import { getModels } from "../api/modelApi.js";
import { renderStaticModelsTable } from "../tables/modelTable.js";
import { buildMembersPanel, createMembersSection } from "../widgets/teamMembers.js";
import { appendCreateCard } from "../cards/createCard.js";
import { buildStatCards } from "../cards/statCards.js";
import { buildRoleBadge } from "../components/badges.js";
import { loadRecordPage } from "../templates/record-loader.js";
import {
  EDIT_ACTION,
  EDIT_ACTIONS,
  buildBody,
  buildHeader,
  buildPage,
  buildSection,
  buildSections,
  buildStats,
  pageMessage,
  renderDetails,
  renderHeader,
  renderPage,
  sectionBody,
} from "../templates/record-page.js";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

const MAX_MODELS = 5;

// Models first: it is what a visitor came for, and the only section a non-member sees.
//
// No "view all" link, deliberately: the models list is every team's, and pointing a team
// page at it would quietly change what the reader is looking at.
const MODELS_SECTION = {
  id: "models",
  title: "Models",
};

const MEMBERS_SECTION = {
  id: "members",
  title: "Members",
  view: "details",
  linkIcon: "users",
  linkText: "Manage members",
};

// The same section without the link: the details view is where "Manage members" leads.
const MEMBERS_SECTION_BODY = {
  id: "members",
  title: "Members",
};

const BACK = {
  text: "← Back to dashboard",
  view: "dashboard",
};

// ─── DATA ────────────────────────────────────────────────────────────────────

function getStatistics(team) {
  return [
    ["members", team.n_members ?? 0, "users"],
    ["models", team.n_models ?? 0, "chart-column"],
    ["submissions", team.n_submissions ?? 0, "layers"],
  ];
}

// A separate question from `canEdit`: renaming the team is any member's, but deciding who
// is *in* it is the owner's, and the server refuses the rest with a 403. Offering the
// controls to a collaborator would only produce that error on save.
function isOwner(team) {
  return team.role === "owner";
}

// ─── UTILS ───────────────────────────────────────────────────────────────────

function pluralise(count, noun) {
  return `${count ?? 0} ${noun}${count === 1 ? "" : "s"}`;
}

function getSubtitle(team) {
  return [
    pluralise(team.n_members, "member"),
    pluralise(team.n_models, "model"),
  ].join(" · ");
}

// ─── MARKUP ──────────────────────────────────────────────────────────────────

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
    </div>
  `;
}

// ─── DASHBOARD SECTIONS ──────────────────────────────────────────────────────

function renderStatsSection(statistics) {
  sectionBody("stats").innerHTML = buildStatCards(statistics);
}

// No Team column: every row is this team's, which the page's own heading already says.
function renderModelsSection(models) {
  const container = sectionBody("models");

  if (!models.length) {
    showEmpty(container, "No models yet.");
    return;
  }

  renderStaticModelsTable({ container, models, showTeam: false, limit: MAX_MODELS });
}

// Only reached for a member — the section itself isn't built for anyone else, since the
// API withholds the list and a block saying so is noise on a public page.
function renderMembersSection(team) {
  const container = sectionBody("members");

  if (!team.members.length) {
    showEmpty(container, "No members yet.");
    return;
  }

  container.innerHTML = buildMemberTable(team.members);
}

// ─── VIEWS ───────────────────────────────────────────────────────────────────

function renderDashboardView(context, router) {
  const { team, models, canEdit } = context;

  renderPage(
    buildPage({
      header: buildHeader(canEdit ? [EDIT_ACTION] : []),
      body:
        buildStats("grid-3") +
        buildSections(canEdit ? [MODELS_SECTION, MEMBERS_SECTION] : [MODELS_SECTION]),
    }),
  );

  renderHeader(team.name, getSubtitle(team));

  renderStatsSection(getStatistics(team));
  renderModelsSection(models);

  if (!canEdit) return;

  renderMembersSection(team);

  attachEditLink(router);

  // Manage members means the same thing as Edit, so it opens the editor too. Without
  // stopPropagation the router's own delegated handler would also see this click and
  // navigate a second time, landing read-only.
  document.querySelector("[data-view='details']").addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    router.goTo("details", { edit: true });
  });
}

function renderDetailsView({ team, fields, canEdit, edit = false, created = false }) {
  renderPage(
    buildPage({
      back: BACK,
      header: buildHeader(canEdit ? EDIT_ACTIONS : []),
      body:
        buildBody() +
        (canEdit ? buildSections([MEMBERS_SECTION_BODY]) : "") +
        (created ? buildSection({ id: "post-create" }) : ""),
    }),
  );

  renderHeader(team.name, getSubtitle(team));
  renderDetails(team, fields, TEAM_PANELS);

  // Only when team_create.html sent us here. A team made moments ago owns nothing yet.
  if (created) {
    showSuccess(pageMessage(), "Team successfully created.");

    appendCreateCard(sectionBody("post-create"), {
      href: "/html/models/model_create.html",
      label: "Register your first model for this team",
    });
  }

  // A reader who may not edit sees the card and nothing else: the members block would
  // report an empty team rather than an unreadable one, and every write it offers would 403.
  if (!canEdit) return;

  sectionBody("members").innerHTML = buildMembersPanel();

  const members = createMembersSection({
    getTeam: () => team,
    onMessage: (message, failed) => (failed
      ? showFailure(pageMessage(), message)
      : showMessage(pageMessage(), message)),
  });

  members.render();

  // Set by `save`, read by `onSaved`: the editor's save must return the one record it
  // merges, so per-member failures have no way through except a variable scoped to here.
  let failedMembers = [];

  attachRecordEditor({
    noun: "team",
    record: team,
    fields,
    panels: TEAM_PANELS,
    edit,
    renderTitle: saved => renderHeader(saved.name, getSubtitle(saved)),

    onEdit: () => members.setEditing(isOwner(team)),

    // Members first, then the rename: PATCH answers with the full TeamDetail, so doing it
    // last means the response already reflects the membership changes.
    save: async draft => {
      failedMembers = await members.apply();

      return updateTeam(team.id, draft);
    },

    onSaved: () => {
      members.setEditing(false);
      members.render();

      // attachRecordEditor has already reported the save; this overwrites it only when the
      // rename went through but a member didn't, which the standard card cannot say.
      if (failedMembers.length) {
        showFailure(
          pageMessage(),
          "Team saved, but some members could not be changed.",
          new Error(failedMembers.join("; ")),
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

const VIEWS = {
  dashboard: renderDashboardView,
  details: renderDetailsView,
};

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

    // Both halves, as on the model and submission pages: `can_edit` is team membership as
    // the API sees it, `signedIn` is this browser having a session at all.
    return {
      team,
      models,
      fields: TEAM_FIELDS,
      canEdit: signedIn && team.can_edit === true,
    };
  },
});
