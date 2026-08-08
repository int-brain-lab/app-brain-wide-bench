// Page entry for html/teams/team_members.html — add and remove a team's members.
//
// Renaming is not here: that's team_details.html, and this page deliberately shows no
// Edit button. The block itself lives in teamMembersSection.js, which team_details.html
// mounts as well.

import { loadTeam } from "./teamApi.js";
import { renderMessage } from "../utils.js";
import { attachMembersSection } from "./teamMembersSection.js";

// Mutated in place so the section's getTeam always sees the current record.
const context = { team: null };

// Set in loadTeamMembersPage. Immediate mode — no Save on this page to defer to.
let members = null;


// ─── RENDERING ──────────────────────────────────────────────────────────────

function renderHeader(team) {
  document.getElementById("team-title").textContent = team.name;
  document.getElementById("team-description").textContent =
    `${team.n_members} member${team.n_members === 1 ? "" : "s"} · ` +
    `${team.n_models} model${team.n_models === 1 ? "" : "s"}`;
}

function renderBackLink(team) {
  const backToTeam = document.getElementById('back-to-team');
  backToTeam.textContent = `← Back to ${team.name}`;
  backToTeam.href = `/html/teams/team_dashboard.html?id=${encodeURIComponent(team.id)}`;
}

function showMessage(message, className = "info-msg") {
  const container = document.getElementById("form-message");

  if (!message) {
    container.hidden = true;
    container.replaceChildren();
    return;
  }

  renderMessage(container, message, className);
}

function renderAll(team) {
  context.team = team;

  renderHeader(team);
  renderBackLink(team);
  members?.render();
}


// ─── EVENTS ─────────────────────────────────────────────────────────────────

async function reload() {
  const team = await loadTeam(context.team.id);

  if (!team) {
    showMessage("Could not reload this team.", "error-msg");
    return;
  }

  renderAll(team);
}


async function loadTeamMembersPage() {
      const teamId = new URLSearchParams(location.search).get("id");

      if (!teamId) {
        showMessage("No team id in the URL.", "error-msg");
        return;
      }

      const team = await loadTeam(teamId);

      if (!team) {
        showMessage("Could not load this team.", "error-msg");
        return;
      }

      context.team = team;

      members = attachMembersSection({
        getTeam: () => context.team,
        onChanged: reload,
        onMessage: showMessage,
      });

      renderAll(team);

      globalThis.lucide?.createIcons?.();
}

loadTeamMembersPage()
