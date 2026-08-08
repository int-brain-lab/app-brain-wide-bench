// Page entry for html/teams/team_dashboard.html — the read-only overview of one team.
//
// Both writes (rename, membership) live on team_details.html, which the two header
// buttons link to. Nothing here mutates, so there's no editor and no reload.

import { loadTeam } from "./teamApi.js";
import { escapeHtml, renderMessage } from "../utils.js";


// Where each button goes. Both need the team id, so the hrefs can't be static.
//
// Edit carries `&edit`, which teamDetails.js reads to open in edit mode rather than
// landing on the read-only card and making you click Edit a second time.
const TEAM_PAGE_LINKS = {
  "edit-team": "/html/teams/team_details.html",
  "manage-members": "/html/teams/team_members.html",
};

const EDIT_ON_ARRIVAL = new Set(["edit-team"]);


// ─── RENDERING ──────────────────────────────────────────────────────────────

function renderHeader(team) {
  document.getElementById("page-title").textContent = team.name;
  document.getElementById("page-description").textContent =
    `${team.n_members} member${team.n_members === 1 ? "" : "s"} · ` +
    `${team.n_models} model${team.n_models === 1 ? "" : "s"}`;
}

function buildMemberRow(member) {
  return `
    <tr>
      <td>${escapeHtml(member.name || "—")}</td>
      <td>${escapeHtml(member.email)}</td>
    </tr>`;
}

// `members` is null — not empty — when the caller isn't in the team. The counts are
// still rendered above, which is all a non-member is entitled to see.
function renderMembers(team) {
  const container = document.getElementById("member-list");

  if (team.members === null || team.members === undefined) {
    renderMessage(container, "Only members of this team can see who is in it.");
    return;
  }

  container.innerHTML = `
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

// Hidden for a non-member: both pages they lead to would 403 on save, so offering them
// only produces an error further in.
function renderPageLinks(team) {
  const visible = Array.isArray(team.members);

  for (const [id, page] of Object.entries(TEAM_PAGE_LINKS)) {
    const link = document.getElementById(id);
    if (!link) continue;

    link.href = `${page}?id=${encodeURIComponent(team.id)}`
      + (EDIT_ON_ARRIVAL.has(id) ? "&edit" : "");
    link.hidden = !visible;
  }
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


// ─── INITIALISATION ─────────────────────────────────────────────────────────

async function loadTeamDashboardPage() {
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

      renderHeader(team);
      renderMembers(team);
      renderPageLinks(team);

      globalThis.lucide?.createIcons?.();
}

loadTeamDashboardPage()
