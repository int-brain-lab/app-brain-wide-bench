// A team as the pages read it: its rows, the filters over them, and the figures its own
// page heads with.

import { buildCount } from "../components/count.js";
import { matchEquals, matchIncludes, optionsFromRows } from "../components/filters.js";
import { getIcon } from "../components/icons.js";

// ─── ROWS ────────────────────────────────────────────────────────────────────

function toTeamRow(team) {
  return {
    id: team.id,
    name: team.name,
    // The caller's own role, absent on a team they aren't in.
    role: team.role ?? null,
    // Whose it is, which a row's link carries as its shell hint — see core/links.js. Not
    // `role`: an admin holds none and every team is still theirs to edit.
    is_mine: team.is_mine ?? false,
    n_members: team.n_members ?? 0,
    n_models: team.n_models ?? 0,
    n_submissions: team.n_submissions ?? 0,
  };
}

function toTeamRows(teams) {
  return teams.map(toTeamRow);
}

// ─── FILTERS ─────────────────────────────────────────────────────────────────

// Roles come from the rows rather than a fixed list: on the public list most teams carry
// none, and an "Owner" option that matches nothing would be a control that does nothing.
function getTeamFilters(rows) {
  return [
    {
      type: "search",
      name: "name",
      placeholder: "Search teams...",
      match: matchIncludes("name"),
    },
    {
      type: "pinned",
      name: "role",
      label: "Role",
      options: optionsFromRows(rows, "role"),
      match: matchEquals("role"),
    },
  ];
}

// ─── DISPLAY ─────────────────────────────────────────────────────────────────

// Renaming a team is any member's; deciding who is *in* it is the owner's or an admin's.
// Answered by the API rather than derived from `role`, which an admin holds none of.
function canManageMembers(team) {
  return team.can_manage_members === true;
}

/**
 * What the team holds, under its own name — the same three its dashboard lists below, said
 * once at the top rather than in cards saying it a second time.
 *
 * @returns the parts, in reading order — see buildSubtitle in components/sections.js.
 */
function getTeamSubtitle(team) {
  return [
    { text: buildCount(team.n_members, "member"), icon: getIcon("member") },
    { text: buildCount(team.n_models, "model"), icon: getIcon("model") },
    {
      text: buildCount(team.n_submissions, "submission"),
      icon: getIcon("submission"),
    },
  ].filter((entry) => entry.text);
}

export { canManageMembers, getTeamFilters, getTeamSubtitle, toTeamRows };
