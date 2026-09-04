// The teams list, in the two scopes the pages ask for:
//
//   data-scope="mine"  team_list.html         —  the viewer's own teams, signed in only
//   data-scope="all"   team_list_public.html  —  every team they may see, signed out too

import { getMyTeams, getTeams } from "../api/teamApi.js";
import { getTeamFilters, toTeamRows } from "../utils/teamUtils.js";
import { createTeamsTable } from "../tables/teamTable.js";
import { createTeamCardGrid } from "../cards/teamCards.js";
import { loadListPage } from "../templates/listPage.js";

const MINE = document.body.dataset.scope === "mine";

loadListPage({
  noun: "team",
  title: MINE ? "My teams" : "Teams",
  requiresAuth: MINE,

  // GET /api/teams lists every team either way; what changes with the caller is the model
  // and submission counts on each, which are scoped to what they may see.
  getRecords: MINE ? getMyTeams : getTeams,
  recordsToRows: toTeamRows,

  createCards: () => createTeamCardGrid(),

  createTable: ({ rows }) =>
    createTeamsTable({
      rows,
      showFilters: false,
    }),

  createLink: "/html/teams/team_create.html",
  filterControls: getTeamFilters,
});
