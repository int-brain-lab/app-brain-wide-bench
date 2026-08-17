// The models the user has created or has access to.

import { getMyModels } from "../api/modelApi.js";
import { renderModelsTable } from "../tables/modelTable.js";
import { buildModelCards } from "../cards/modelCards.js";
import { loadListPage } from "../templates/list-page.js";

loadListPage({
  title: "My models",
  noun: "models",
  fetch: getMyModels,
  cards: buildModelCards,
  table: ({ container, rows }) => renderModelsTable({ container, models: rows }),
  create: {
    href: "/html/models/model_create.html",
    label: "New model",
  },
});
