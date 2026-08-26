// The teams list, in the two scopes the pages ask for:
//
//   data-scope="mine"  team_list.html         — the teams the viewer belongs to, signed in only
//   data-scope="all"   team_list_public.html  — every team, readable signed out

import { getTeams, getMyTeams } from "../api/teamApi.js";
import { buildTeamCards } from "../cards/teamCards.js";
import {
  getTeamControls,
  renderTeamsTable,
  toTeamRows,
} from "../tables/teamTable.js";
import { loadListPage } from "../templates/list-page.js";

const MINE = document.body.dataset.scope === "mine";

loadListPage({
  title: MINE ? "My teams" : "Teams",
  noun: "teams",
  // GET /api/teams lists every team either way; what changes with the caller is the model
  // and submission counts on each, which are scoped to what they may see.
  fetch: MINE ? getMyTeams : getTeams,
  requiresAuth: MINE,
  toRows: toTeamRows,
  // The table's own controls, hoisted to the page: one bar over both views, and the cards
  // render from the rows it matches against.
  filters: getTeamControls,
  cards: buildTeamCards,
  table: ({ container, rows }) =>
    renderTeamsTable({ container, rows, showFilters: false }),
  create: {
    href: "/html/teams/team_create.html",
    label: "New team",
  },
});
