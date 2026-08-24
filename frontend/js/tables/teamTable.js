// Filterable teams table
//
// The table allows you to search by team name and filter by your role on it.
//
// This code just defines the columns, rows and controls. Table infrastructure lives in
// table.js.

import {
  createFilterableTable,
  matchEquals,
  matchIncludes,
  optionsFromRows,
} from "./table.js";
import { linkFormatter, roleBadgeFormatter } from "./formatters.js";


// ─── ROWS ───────────────────────────────────────────────────────────────────

function toTeamRow(team) {
  return {
    id: team.id,
    name: team.name,
    // The caller's own role, absent on a team they aren't in — which the public list is
    // full of, so the column renders those as "—" rather than leaving a blank.
    role: team.role ?? null,
    n_members: team.n_members ?? 0,
    n_models: team.n_models ?? 0,
    n_submissions: team.n_submissions ?? 0,
  };
}

function toTeamRows(teams) {
  return teams.map(toTeamRow);
}


// ─── COLUMNS ────────────────────────────────────────────────────────────────

function getTeamColumns() {
  return [
    {
      title: "Team",
      field: "name",
      formatter: linkFormatter("/html/teams/teams.html", "name"),
      widthGrow: 2,
    },
    {
      title: "Your role",
      field: "role",
      formatter: roleBadgeFormatter,
      width: 130,
    },
    {
      title: "Members",
      field: "n_members",
      width: 110,
    },
    {
      title: "Models",
      field: "n_models",
      width: 110,
    },
    {
      title: "Submissions",
      field: "n_submissions",
      width: 130,
    },
  ];
}


// ─── CONTROLS ───────────────────────────────────────────────────────────────

// Roles come from the rows rather than a fixed list: on the public list most teams carry
// none, and an "Owner" option that matches nothing would be a control that does nothing.
function getTeamControls(rows) {
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


// ─── TABLE ──────────────────────────────────────────────────────────────────

/**
 * @param container element, or the id of one. Its contents are replaced.
 * @param teams     as renderTeamsTable's caller has them, mapped to rows by toTeamRows().
 * @returns the Tabulator instance.
 */
function renderTeamsTable({ container, teams }) {
  const rows = toTeamRows(teams);

  return createFilterableTable({
    container,
    rows,
    columns: getTeamColumns(),
    controls: getTeamControls(rows),
    noun: "team",
    initialSort: [{ column: "name", dir: "asc" }],
    caller: "renderTeamsTable",
  });
}


export { renderTeamsTable };
