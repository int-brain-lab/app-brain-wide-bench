// One card per team, for the team list and the user dashboard.
//
// Built from a team *row* — tables/teamTable.js's toTeamRows — not from the API record, so
// that the cards, the filters above them and the table beside them all read one shape. The
// two happen to carry the same fields here.

import { escapeHtml } from "../core/utils.js";
import { buildRoleBadge } from "../components/badges.js";
import { buildCount } from "../components/count.js";


function buildTeamCards(teams) {

  // `role` is the caller's own role on this team, and only the listings scoped to them
  // carry one — buildRoleBadge renders nothing when it's absent, so a card for a team
  // they aren't in simply doesn't have the badge.
  return teams.map(team => `
    <a
    class="card column left gap-md"
    href="/html/teams/teams.html?id=${encodeURIComponent(team.id)}"
    >
      <p class="title">${escapeHtml(team.name)}</p>
      ${buildRoleBadge(team.role, "sm")}
      <p class="metadata">
        ${buildCount(team.n_members, "member")}
        · ${buildCount(team.n_models, "model")}
      </p>
    </a>
  `).join("");
}


export { buildTeamCards };
