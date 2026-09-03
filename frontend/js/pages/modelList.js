// The models list, in the two scopes the pages ask for:
//
//   data-scope="mine"  model_list.html         —  the viewer's own teams', signed in only
//   data-scope="all"   model_list_public.html  —  every model they may see, signed out too

import { getModels, getMyModels } from "../api/modelApi.js";
import { getModelFilters, toModelRows } from "../utils/modelUtils.js";
import { createModelsTable } from "../tables/modelTable.js";
import { createModelCardGrid } from "../cards/modelCards.js";
import { MAX_MODELS } from "../comparisons/modelComparison.js";
import { SERIES_COLOURS } from "../plots/palette.js";
import { loadListPage } from "../templates/listPage.js";

const MINE = document.body.dataset.scope === "mine";

// Where Compare goes, and under what name. `with` is the compare page's own parameter for the
// models a comparison holds — see pages/compare.js.
const COMPARE_PAGE = "/html/models/compare.html";
const WITH_PARAM = "with";

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

  // No panel: the list picks, and the comparison is a page of its own.
  //
  // A row highlights rather than opening anything, the model's own name still goes to its
  // page, and Compare hands the picks to /compare.html — which is the same widget the list
  // used to mount underneath itself, given the width of a page instead of half of one.
  picking: {
    max: MAX_MODELS,

    // The comparison's own palette, and its own cap: a row is marked here in the colour its
    // model will be drawn in over there. Slots go out in pick order and the URL carries that
    // order, so the two agree without either page knowing the other's colours.
    palette: SERIES_COLOURS,

    label: "Compare",

    toEntry: (row) => ({ key: row.id }),

    onCompare: (ids) => {
      location.href = `${COMPARE_PAGE}?${WITH_PARAM}=${encodeURIComponent(ids.join(","))}`;
    },
  },
});
