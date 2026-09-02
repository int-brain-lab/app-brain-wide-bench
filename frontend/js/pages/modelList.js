// The models list, in the two scopes the pages ask for:
//
//   data-scope="mine"  model_list.html         —  the viewer's own teams', signed in only
//   data-scope="all"   model_list_public.html  —  every model they may see, signed out too

import { getModels, getMyModels } from "../api/modelApi.js";
import { getModelFilters, toModelRows } from "../utils/modelUtils.js";
import { createModelsTable } from "../tables/modelTable.js";
import { createModelCardGrid } from "../cards/modelCards.js";
import { createModelBreakdown } from "../comparisons/modelBreakdown.js";
import { createModelComparison } from "../comparisons/modelComparison.js";
import { bindTableSelection } from "../comparisons/comparison.js";
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
    // The default panel: a row opens the model beside the list, no button first. Its table
    // follows the model link rather than claiming it, so the name still reaches the model's
    // own page while a click anywhere else on the row opens the breakdown.
    base: {
      label: "Breakdown",
      title: "Model breakdown",
      create: (container) => createModelBreakdown({ container }),
      bindTable: (controller) =>
        bindTableSelection(controller, { claimLinks: false, rolling: true }),
    },
    active: {
      label: "Compare",
      title: "Compare models",
      create: (container) => createModelComparison({ container }),
    },
  },
});
