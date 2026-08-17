// The teams the user belongs to.
//
// No `table`, so no toggle: a team is a name and a member count, which a card says better
// than a row and which nobody needs to filter.

import { getMyTeams } from "./teamApi.js";
import { buildTeamCards } from "../components/cards.js";
import { loadListPage } from "../pages/list-page.js";

loadListPage({
  title: "My teams",
  noun: "teams",
  fetch: getMyTeams,
  cards: buildTeamCards,
  create: {
    href: "/html/teams/team_create.html",
    label: "New team",
  },
});
