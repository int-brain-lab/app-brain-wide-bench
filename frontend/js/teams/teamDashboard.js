// Team dashboard
//
// A dashboard for a single team, showing its stats and its members.
//
// Read-only. Both writes live on team_details.html, which the two header buttons link to,
// so there is no editor and no reload here.

import { loadTeam } from "./teamApi.js";
import { escapeHtml, showError, showMessage } from "../utils.js";
import { buildStatCards } from "../components/cards.js";
import { isAuthenticated } from "../api.js";
import { showGate } from "../utils/gate.js";

// ─── CONFIGURATION ──────────────────────────────────────────────────────────

// Both go to team_details.html, and both arrive in edit mode. There used to be a separate
// team_members.html doing membership immediately — one request per click — while the
// details page staged the same changes behind its Save. Two routes to one capability with
// different transaction semantics was the confusing part, so membership now happens in
// exactly one place; the buttons differ only in what they draw attention to.
const TEAM_PAGE_LINKS = {
  "edit-team": "/html/teams/team_details.html",
  "manage-members": "/html/teams/team_details.html",
};

// `&edit` is what teamDetails.js reads to open in edit mode rather than landing on the
// read-only card and making you click Edit a second time.
const EDIT_ON_ARRIVAL = new Set(["edit-team", "manage-members"]);

// ─── DOM ────────────────────────────────────────────────────────────────────

function getElements() {
  return {
    gate: document.getElementById("gate"),
    message: document.getElementById("form-message"),
    title: document.getElementById("page-title"),
    description: document.getElementById("page-description"),
    stats: document.getElementById("team-stats"),
    members: document.getElementById("member-list"),
    links: Object.fromEntries(
      Object.keys(TEAM_PAGE_LINKS).map(id => [
        id,
        document.getElementById(id),
      ]),
    ),
  };
}

// ─── DATA ───────────────────────────────────────────────────────────────────

function getStatistics(team) {
  return [
    [
      "members",
      team.n_members ?? 0,
      "users"
    ],
    [
      "models",
      team.n_models ?? 0,
      "chart-column"
    ],
    [
      "submissions",
      team.n_submissions ?? 0,
      "layers"
    ],
  ];
}

// A member list is present only for a member — `null` means "not shown to you", which is
// a different answer from an empty team, and the two must not render the same way.
function isMember(team) {
  return Array.isArray(team.members);
}

// ─── RENDERING ──────────────────────────────────────────────────────────────

function renderHeader(elements, team) {
  elements.title.textContent = team.name;

  elements.description.textContent = isMember(team)
    ? "You are a member of this team."
    : "";
}

function renderStats(elements, statistics) {
  elements.stats.innerHTML = buildStatCards(statistics);
}

function buildMemberRow(member) {
  return `
    <tr>
      <td>${escapeHtml(member.name || "—")}</td>
      <td>${escapeHtml(member.email)}</td>
    </tr>
  `;
}

function renderMembers(elements, team) {
  if (!isMember(team)) {
    showMessage(
      elements.members,
      "Only members of this team can see who is in it.",
    );
    return;
  }

  if (team.members.length === 0) {
    showMessage(elements.members, "This team has no members.");
    return;
  }

  elements.members.innerHTML = `
    <div class="table">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
          </tr>
        </thead>
        <tbody>
          ${team.members.map(buildMemberRow).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderDashboard(elements, team) {
  renderHeader(elements, team);
  renderStats(elements, getStatistics(team));
  renderMembers(elements, team);
}

// ─── EVENTS ─────────────────────────────────────────────────────────────────

// Hidden for a non-member: both pages they lead to would 403 on save, so offering them
// only produces an error further in.
function attachLinks(elements, team) {
  const visible = isMember(team);

  for (const [id, page] of Object.entries(TEAM_PAGE_LINKS)) {
    const link = elements.links[id];

    if (!link) continue;

    link.href = `${page}?id=${encodeURIComponent(team.id)}`
      + (EDIT_ON_ARRIVAL.has(id) ? "&edit" : "");

    link.hidden = !visible;
  }
}

// ─── INITIALISATION ─────────────────────────────────────────────────────────

async function loadTeamDashboardPage() {
  const elements = getElements();

  try {
    if (!(await isAuthenticated())) {
      showGate(elements, false);
      return;
    }

    showGate(elements, true);

    const teamId = new URLSearchParams(location.search).get("id");

    if (!teamId) {
      showError(elements.message, "No team id in the URL.");
      return;
    }

    const team = await loadTeam(teamId);

    if (!team) {
      showError(elements.message, `Could not load team ${teamId}.`);
      return;
    }

    renderDashboard(elements, team);

    // After the render, so a throw in there can't leave the buttons pointing at "#" —
    // which is what made them look inert rather than reporting the failure.
    attachLinks(elements, team);

    globalThis.lucide?.createIcons?.();
  } catch (error) {
    console.error("Failed to load team dashboard:", error);

    showError(
      elements.message,
      "Team dashboard page could not be loaded.",
    );
  }
}

loadTeamDashboardPage();
