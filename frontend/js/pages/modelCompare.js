// Compare page — a handful of models read against each other.
//
// Two ways in, and the difference between them is only which models it opens on:
//
//   /compare.html?id=<model>   from that model's own page. It opens on that model, held for
//                              the life of the page, and is titled after it. There is a way
//                              back to it.
//   /compare.html?with=<ids>   from the models list, which picked them. It opens on exactly
//                              those and is titled after what it is rather than after any of
//                              them.
//
// The page itself is templates/comparePage.js: the shell, the URL, the select that puts one
// more in. This module is only what makes it a comparison of *models* — what it loads, what
// its header says, and where a reader goes back to.
//
// No suite select above it: which suite the scores are read on is the widget's own control,
// inside the panel the scores are in.

import { getModels } from "../api/modelApi.js";
import { toModelRows } from "../utils/modelUtils.js";
import { getIcon } from "../components/icons.js";
import { createModelComparison } from "../comparisons/modelComparison.js";
import { loadComparePage } from "../templates/comparePage.js";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

// What the page is called with no model to name it after.
const SET_TITLE = "Compare models";

const ID_PARAM = "id";

// ─── HEADER ──────────────────────────────────────────────────────────────────

function getSubtitle(model) {
  return [{ text: model.team_name, icon: getIcon("team") }].filter((entry) => entry.text);
}

// ─── LOAD ────────────────────────────────────────────────────────────────────

// The model the page opens on, or null for a set brought from the list. Read here rather than
// through loadPage, which would refuse the page outright for want of an id this one can do
// without.
function readModelId() {
  return new URLSearchParams(location.search).get(ID_PARAM);
}

loadComparePage({
  noun: "model",

  // A model with a public submission is readable by anyone — see GET /api/models, which is
  // also what says which models this reader may compare.
  requiresAuth: false,

  load: async () => {
    const modelId = readModelId();
    const models = (await getModels()) ?? [];

    const model = modelId ? (models.find((one) => String(one.id) === modelId) ?? null) : null;

    // A model named in the URL but absent from the list is a failure; no model at all is not.
    if (modelId && !model) return null;

    return { model, models };
  },

  toRows: ({ models }) => toModelRows(models),
  createComparison: createModelComparison,

  header: ({ model }) =>
    model ? { title: model.name, subtitle: getSubtitle(model) } : { title: SET_TITLE },

  seedIds: ({ model }) => (model ? [model.id] : []),
});
