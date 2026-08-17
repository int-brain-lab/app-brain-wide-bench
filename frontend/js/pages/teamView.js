// Team record page — dashboard and details for one team.

import { escapeHtml, showError, showMessage } from "../core/utils.js";
import { attachEditLink, attachRecordEditor } from "../templates/record-editor.js";
import { TEAM_FIELDS, TEAM_PANELS } from "../schemas/teamSchema.js";
import { loadTeam, updateTeam } from "../api/teamApi.js";
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
  buildMessage,
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

const DASHBOARD_SECTIONS = [
  {
    id: "members",
    title: "Members",
    view: "details",
    linkIcon: "users",
    linkText: "Manage members",
  },
];

const DETAILS_SECTIONS = [
  {
    id: "members",
    title: "Members",
  },
];

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

// A member list is present only for a member — `null` means "not shown to you", which is a
// different answer from an empty team, and the two must not render the same way.
function isMember(team) {
  return Array.isArray(team.members);
}

// A separate question from isMember: renaming the team is any member's, but deciding who
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

function renderMembersSection(team) {
  const container = sectionBody("members");

  if (!isMember(team)) {
    showMessage(container, "Only members of this team can see who is in it.");
    return;
  }

  if (!team.members.length) {
    showMessage(container, "This team has no members.");
    return;
  }

  container.innerHTML = buildMemberTable(team.members);
}

// ─── VIEWS ───────────────────────────────────────────────────────────────────

function renderDashboardView(context, router) {
  const { team } = context;
  const member = isMember(team);

  renderPage(
    buildPage({
      header: buildHeader(member ? [EDIT_ACTION] : []),
      body: buildStats("grid-3") + buildSections(DASHBOARD_SECTIONS),
    }),
  );

  renderHeader(team.name, getSubtitle(team));

  renderStatsSection(getStatistics(team));
  renderMembersSection(team);

  if (!member) return;

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

function renderDetailsView({ team, fields, edit = false, created = false }) {
  const member = isMember(team);

  renderPage(
    buildPage({
      back: BACK,
      header: buildHeader(member ? EDIT_ACTIONS : []),
      body:
        buildMessage() +
        buildBody() +
        (member ? buildSections(DETAILS_SECTIONS) : "") +
        (created ? buildSection({ id: "post-create" }) : ""),
    }),
  );

  renderHeader(team.name, getSubtitle(team));
  renderDetails(team, fields, TEAM_PANELS);

  // Only when team_create.html sent us here. A team made moments ago owns nothing yet.
  if (created) {
    appendCreateCard(sectionBody("post-create"), {
      href: "/html/models/model_create.html",
      label: "Register your first model for this team",
    });
  }

  // A non-member sees the card and nothing else: the members block would report an empty
  // team rather than an unreadable one, and every write it offers would 403.
  if (!member) return;

  sectionBody("members").innerHTML = buildMembersPanel();

  const members = createMembersSection({
    getTeam: () => team,
    onMessage: message => showMessage(pageMessage(), message),
  });

  members.render();

  // Set by `save`, read by `onSaved`: the editor's save must return the one record it
  // merges, so per-member failures have no way through except a variable scoped to here.
  let failedMembers = [];

  attachRecordEditor({
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

      // A member that couldn't be added doesn't undo the rename, so both outcomes are
      // reported rather than the failure replacing the success.
      if (failedMembers.length === 0) {
        showMessage(pageMessage(), "Changes saved.");
      } else {
        showError(
          pageMessage(),
          `Saved, but some members could not be changed — ${failedMembers.join("; ")}`,
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

  load: async teamId => {
    const team = await loadTeam(teamId);

    if (!team) {
      return null;
    }

    return { team, fields: TEAM_FIELDS };
  },
});
