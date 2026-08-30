// One card per team, for the team list and the user dashboard.
//
// Built from a team row — utils/teamUtils.js's toTeamRows — so the cards, the filters
// above them and the table beside them read one shape.

import { escapeHtml } from "../core/html.js";
import { buildRoleBadge } from "../components/badges.js";
import { buildCount } from "../components/count.js";
import { createCardGrid } from "./cardGrid.js";

// `role` is the caller's own, and only the listings scoped to them carry one.
// buildRoleBadge renders nothing when it's absent.
function buildTeamCard(team) {
  const role = buildRoleBadge(team.role, "sm");

  return `
    <a
      class="card column left gap-md"
      href="/html/teams/teams.html?id=${encodeURIComponent(team.id)}"
    >
      <div class="column left">
        <p class="title">${escapeHtml(team.name)}</p>
      </div>

      ${role ? `<div class="row left gap-md">${role}</div>` : ""}

      <p class="metadata">
        ${buildCount(team.n_members, "member")}
        · ${buildCount(team.n_models, "model")}
      </p>
    </a>
  `;
}

function buildTeamCards(teams) {
  return teams.map(buildTeamCard).join("");
}

/**
 * The team card grid, built once and kept.
 *
 * @param options as createCardGrid.
 *
 * @returns as createCardGrid.
 */
function createTeamCardGrid(options = {}) {
  return createCardGrid({
    buildCards: buildTeamCards,
    noun: "team",

    ...options,
  });
}

export { createTeamCardGrid };
