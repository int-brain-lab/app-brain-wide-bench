// Team record page — dashboard and details for one team.

import { escapeHtml, showError, showMessage } from "../utils.js";
import { panelGroups } from "../utils/form-fields.js";
import { Editor } from "../utils/editor.js";
import { TEAM_FIELDS, TEAM_PANELS } from "./teamSchema.js";
import { loadTeam, updateTeam } from "./teamApi.js";
import { buildMembersCard, createMembersSection } from "./teamMembers.js";
import { appendCreateCard } from "../utils/create-card.js";
import { buildStatCards } from "../components/cards.js";
import { loadRecordPage } from "../pages/record-loader.js";
import {
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
} from "../pages/record-page.js";

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

const EDIT_ACTION = {
  id: "edit-button",
  label: "Edit",
  icon: "pencil",
};

const SAVE_ACTION = {
  id: "save-button",
  label: "Save",
  icon: "check",
  className: "primary",
  hidden: true,
};

const CANCEL_ACTION = {
  id: "cancel-button",
  label: "Cancel",
  icon: "x",
  hidden: true,
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

  document.getElementById("edit-button").addEventListener("click", () => {
    router.goTo("details", { edit: true });
  });

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
      header: buildHeader(member ? [EDIT_ACTION, SAVE_ACTION, CANCEL_ACTION] : []),
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

  sectionBody("members").innerHTML = buildMembersCard();

  const members = createMembersSection({
    getTeam: () => team,
    onMessage: message => showMessage(pageMessage(), message),
  });

  members.render();

  // Set by `save`, read by `onSaved`: the editor's save must return the one record it
  // merges, so per-member failures have no way through except a variable scoped to here.
  let failedMembers = [];

  Editor({
    container: sectionBody("body"),
    editButton: document.getElementById("edit-button"),
    saveButton: document.getElementById("save-button"),
    cancelButton: document.getElementById("cancel-button"),
    record: team,
    fields,
    groups: () => panelGroups(fields, TEAM_PANELS, { columns: 1 }),

    onEdit: () => members.setEditing(true),

    // Members first, then the rename: PATCH answers with the full TeamDetail, so doing it
    // last means the response already reflects the membership changes.
    save: async draft => {
      failedMembers = await members.apply();

      return updateTeam(team.id, draft);
    },

    onSaved: saved => {
      members.setEditing(false);

      renderHeader(saved.name, getSubtitle(saved));
      renderDetails(saved, fields, TEAM_PANELS);
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
      renderDetails(team, fields, TEAM_PANELS);
    },

    onError: message => {
      showError(pageMessage(), message);
    },
  }).attach();

  if (edit) {
    document.getElementById("edit-button").click();
  }
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
