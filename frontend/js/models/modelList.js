// The models the user has created or has access to.

import { getMyModels } from "./modelApi.js";
import { renderModelsTable } from "./modelTable.js";
import { buildModelCards } from "../components/cards.js";
import { loadListPage } from "../pages/list-page.js";

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
