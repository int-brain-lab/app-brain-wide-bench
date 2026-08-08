// Filterable teams table: a name search plus a membership select above a Tabulator
// grid. All the table plumbing lives in tables/utils.js — this module is just the rows,
// the columns and the two controls.

import { escapeHtml } from "../utils.js";
import {
  createFilterableTable,
  linkFormatter,
  matchEquals,
  matchIncludes,
} from "./utils.js";


// ─── CONSTANTS ──────────────────────────────────────────────────────────────

// `is_member` is added by the list page, not returned by the API — /api/teams is every
// team and /api/users/me/teams is only the caller's. Hardcoded rather than derived from
// the rows so both options stay offered even when every team happens to be one or the
// other.
const MEMBERSHIP_OPTIONS = [
  { value: "yes", label: "My teams" },
  { value: "no", label: "Other teams" },
];


// ─── ROWS ───────────────────────────────────────────────────────────────────

function toRow(team) {
  return {
    id: team.id,
    name: team.name,
    n_members: team.n_members ?? 0,
    n_models: team.n_models ?? 0,
    // Stored as the select's own values rather than a boolean, so the filter can
    // compare without translating.
    membership: team.is_member ? "yes" : "no",
  };
}


// ─── COLUMNS ────────────────────────────────────────────────────────────────

function membershipFormatter(cell) {
  return cell.getValue() === "yes"
    ? `<span class="badge sm success">Member</span>`
    : `<span class="metadata">—</span>`;
}

function getColumns() {
  return [
    {
      title: "Team",
      field: "name",
      formatter: linkFormatter("/html/teams/team_dashboard.html", "name"),
      widthGrow: 2,
    },
    {
      title: "Members",
      field: "n_members",
      width: 120,
    },
    {
      title: "Models",
      field: "n_models",
      width: 120,
    },
    {
      title: "Membership",
      field: "membership",
      formatter: membershipFormatter,
      headerSort: false,
      width: 140,
    },
  ];
}


// ─── CONTROLS ───────────────────────────────────────────────────────────────

function getControls() {
  return [
    {
      type: "search",
      name: "name",
      placeholder: "Search teams...",
      match: matchIncludes("name"),
    },
    {
      type: "select",
      name: "membership",
      placeholder: "All teams",
      options: MEMBERSHIP_OPTIONS,
      match: matchEquals("membership"),
    },
  ];
}


/**
 * @param container element, or the id of one. Its contents are replaced.
 * @param teams     records from GET /api/teams or GET /api/users/me/teams, each with
 *                  `is_member` attached by the caller.
 * @returns the Tabulator instance.
 */
function renderTeamsTable({ container, teams }) {
  return createFilterableTable({
    container,
    rows: teams.map(toRow),
    columns: getColumns(),
    controls: getControls(),
    noun: "teams",
    initialSort: [{ column: "name", dir: "asc" }],
    caller: "renderTeamsTable",
  });
}


export {
  renderTeamsTable,
  toRow,
  getColumns as teamColumns,
};
