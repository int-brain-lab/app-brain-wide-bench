import { buildCount } from "../components/count.js";
import { getIcon } from "../components/icons.js";
import {
  matchEquals,
  matchIncludes,
  optionsFromRows,
} from "../components/filters.js";

// ─── ROWS ────────────────────────────────────────────────────────────────────

function toTeamRow(team) {
  return {
    id: team.id,
    name: team.name,
    // The caller's own role, absent on a team they aren't in.
    role: team.role ?? null,
    n_members: team.n_members ?? 0,
    n_models: team.n_models ?? 0,
    n_submissions: team.n_submissions ?? 0,
  };
}

export function toTeamRows(teams) {
  return teams.map(toTeamRow);
}

// ─── FILTERS ─────────────────────────────────────────────────────────────────

// Roles come from the rows rather than a fixed list: on the public list most teams carry
// none, and an "Owner" option that matches nothing would be a control that does nothing.
export function getTeamFilters(rows) {
  return [
    {
      type: "search",
      name: "name",
      placeholder: "Search teams...",
      match: matchIncludes("name"),
    },
    {
      type: "select",
      name: "role",
      placeholder: "Any role",
      options: optionsFromRows(rows, "role"),
      match: matchEquals("role"),
    },
  ];
}

// ─── DISPLAY ─────────────────────────────────────────────────────────────────

export function getTeamStatistics(team) {
  return [
    ["members", team.n_members ?? 0, getIcon("team")],
    ["models", team.n_models ?? 0, getIcon("model")],
    ["submissions", team.n_submissions ?? 0, getIcon("submission")],
  ];
}

// A separate question from `canEdit`: renaming the team is any member's, but deciding who
// is *in* it is the owner's, and the server refuses the rest with a 403. Offering the
// controls to a collaborator would only produce that error on save.
export function isTeamOwner(team) {
  return team.role === "owner";
}

export function getTeamSubtitle(team) {
  return [
    { text: buildCount(team.n_members, "member"), icon: getIcon("member") },
    { text: buildCount(team.n_models, "model"), icon: getIcon("model") },
  ].filter((entry) => entry.text);
}
