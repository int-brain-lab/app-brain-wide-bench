// The models list, in the two scopes the pages ask for:
//
//   data-scope="mine"  model_list.html    — the viewer's own teams' models, signed in only
//   data-scope="all"   model_list_public.html  — every model they may see, signed out too
//
// One script because the two differ only in which fetch they call and what the heading
// says: the cards, the table and the create link are the same list either way.

import { getModels, getMyModels } from "../api/modelApi.js";
import { getIcon } from "../components/icons.js";
import { renderModelsTable } from "../tables/modelTable.js";
import { buildModelCards } from "../cards/modelCards.js";
import { loadListPage } from "../templates/list-page.js";

const MINE = document.body.dataset.scope === "mine";

loadListPage({
  title: MINE ? "My models" : "Models",
  noun: "models",
  // GET /api/models filters by visibility, so signed in the public scope is a superset of
  // this one: the viewer's own teams' models plus everyone else's public ones.
  fetch: MINE ? getMyModels : getModels,
  requiresAuth: MINE,
  // Only the public scope marks which rows are the viewer's: on "My models" every one of
  // them is, so a badge on each would carry no information.
  cards: models => buildModelCards(models, { showMine: !MINE }),
  // No id: the comparison page opens on its own reference dropdown, filled from the same
  // list this page is showing. From a single model's page the link carries its id instead
  // and that model is the reference.
  actions: [{
    href: "/html/models/compare.html",
    label: "Compare models",
    icon: getIcon("compare"),
  }],
  table: ({ container, rows }) =>
    renderModelsTable({ container, models: rows, showMine: !MINE }),
  create: {
    href: "/html/models/model_create.html",
    label: "New model",
  },
});
