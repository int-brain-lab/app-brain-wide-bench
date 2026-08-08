import { getMyTeams } from "./teamApi.js";
import { escapeHtml } from "../utils.js";

// The caller's own teams only, from /api/users/me/teams — the same shape as the model
// and submission lists, which are also "mine". /api/teams (every team on the benchmark)
// is still there for the model-create team picker; showing it here meant fetching both
// and tagging each row with an `is_member` flag the card no longer displays.
//
// Cards only, at any length: a team row has little to show beyond its name and two
// counts, so a table would mostly be header. js/tables/teams.js has one if that changes.

// ─── RENDERING ──────────────────────────────────────────────────────────────

function buildCount(count, noun) {
  return `<p class="metadata">${count ?? 0} ${noun}${(count ?? 0) === 1 ? "" : "s"}</p>`;
}

function buildTeamCards(teams) {

  return teams.map(team => `
    <a class="card column left gap-sm" href="/html/teams/team_dashboard.html?id=${encodeURIComponent(team.id)}">
      <p class="title">${escapeHtml(team.name)}</p>
      ${buildCount(team.n_members, "member")}
      ${buildCount(team.n_models, "model")}
    </a>
  `).join("");
}

function renderTeamCards(teams) {
  const teamList = document.getElementById("teams-list")

  teamList.className = 'grid-2'
  teamList.innerHTML = buildTeamCards(teams);
}


// ─── INITIALISATION ──────────────────────────────────────────────────────────

async function loadTeamListPage() {

  const teams = await getMyTeams();
  if (!teams) {
    return
  }

  if (teams.length === 0) {
    document.getElementById("teams-list").replaceChildren();
  } else {
    renderTeamCards(teams);
  }

}



loadTeamListPage();
