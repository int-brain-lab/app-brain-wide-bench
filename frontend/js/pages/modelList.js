// The models list, in the two scopes the pages ask for:
//
//   data-scope="mine"  model_list.html    — the viewer's own teams' models, signed in only
//   data-scope="all"   model_list_public.html  — every model they may see, signed out too
//
// One script because the two differ only in which fetch they call and what the heading
// says: the cards, the table and the create link are the same list either way.

import { getModels, getMyModels } from "../api/modelApi.js";
import { getModelControls, renderModelsTable, toModelRows } from "../tables/modelTable.js";
import { buildModelCards } from "../cards/modelCards.js";
import { MAX_MODELS, createModelComparison } from "../widgets/modelComparison.js";
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
  toRows: toModelRows,
  // The table's own controls, hoisted to the page: one bar over both views, and the cards
  // render from the rows it matches against.
  filters: getModelControls,
  cards: rows => buildModelCards(rows, { showMine: !MINE }),

  // Picked out of the table rather than chosen from a dropdown on a page of its own: the
  // list is already the set to pick from, and the comparison builds underneath it.
  //
  // No suite is passed, so the comparison offers its own select — this page has no control
  // that names one, where the compare page's suite select and the leaderboard's metric
  // select (on a suite rather than Overall) do.
  compare: {
    label: "Compare models",
    title: "Compare models",
    max: MAX_MODELS,
    create: ({ container, onDrop }) => createModelComparison({ container, onDrop }),
    toSeed: row => ({
      key: row.id,
      modelId: row.id,
      name: row.name,
      teamName: row.team_name,
    }),
  },

  table: ({ container, rows, selection }) =>
    renderModelsTable({ container, rows, showMine: !MINE, showFilters: false, selection }),
  create: {
    href: "/html/models/model_create.html",
    label: "New model",
  },
});
