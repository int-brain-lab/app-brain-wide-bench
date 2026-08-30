// The models list, in the two scopes the pages ask for:
//
//   data-scope="mine"  model_list.html         —  the viewer's own teams', signed in only
//   data-scope="all"   model_list_public.html  —  every model they may see, signed out too

import { getModels, getMyModels } from "../api/modelApi.js";
import { getModelFilters, toModelRows } from "../utils/modelUtils.js";
import { createModelsTable } from "../tables/modelTable.js";
import { createModelCardGrid } from "../cards/modelCards.js";
import { createModelComparison } from "../comparisons/modelComparison.js";
import { loadListPage } from "../templates/listPage.js";

const MINE = document.body.dataset.scope === "mine";

loadListPage({
  noun: "model",
  title: MINE ? "My models" : "Models",
  requiresAuth: MINE,

  getRecords: MINE ? getMyModels : getModels,
  recordsToRows: toModelRows,

  createCards: () => createModelCardGrid({ showMine: !MINE }),

  createTable: ({ rows, selection }) =>
    createModelsTable({
      rows,
      showMine: !MINE,
      showFilters: false,
      selection,
    }),

  createLink: "/html/models/model_create.html",
  filterControls: getModelFilters,

  modes: {
    active: {
      label: "Compare",
      title: "Compare models",
      create: (container) => createModelComparison({ container }),
    },
  },
});
