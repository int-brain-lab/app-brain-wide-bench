// Model list
//
// A page showing the models that the user has created or has access to.
//
// A toggle at the top of the page allows the user to switch between card and table views.
// By default, if the user has less than 6 models cards are rendered otherwise a table.

import { getMyModels } from "./modelApi.js";
import { showError } from "../utils.js";
import { renderModelsTable } from "./modelTable.js";
import { buildModelCards} from "../components/cards.js";
import {
  appendCreateCard,
  clearCreateRow,
  renderCreateRow,
} from "../utils/create-card.js";
import { isAuthenticated } from "../api.js";
import { showGate } from "../utils/gate.js";

// ─── CONFIGURATION ──────────────────────────────────────────────────────────

const MAX_CARDS = 6;

const CREATE = {
  href: "/html/models/model_create.html",
  label: "New model",
};

const VIEWS = {
  "view-cards": renderCards,
  "view-table": renderTable,
};

// ─── DOM ────────────────────────────────────────────────────────────────────

function getElements() {
  return {
    gate: document.getElementById("gate"),
    list: document.getElementById("models-list"),
    create: document.getElementById("models-create"),
    cardsButton: document.getElementById("view-cards"),
    tableButton: document.getElementById("view-table"),
  };
}

// ─── RENDERING ──────────────────────────────────────────────────────────────

function renderCards(elements, models) {
  elements.list.className = "grid-2";
  elements.list.innerHTML = buildModelCards(models);

  // The create card is part of the grid, so it becomes the final cell.
  appendCreateCard(elements.list, CREATE);

  // Remove the table-view create row, which is not visible in this layout.
  clearCreateRow(elements.create);
}

function renderTable(elements, models) {
  elements.list.className = "";

  renderModelsTable({
    container: elements.list,
    models,
  });

  // Tabulator owns the list container, so the create control lives separately
  // in a row below the table.
  renderCreateRow(elements.create, CREATE);
}

// ─── VIEW TOGGLE ────────────────────────────────────────────────────────────

function setActiveView(elements, activeId) {
  for (const button of [elements.cardsButton, elements.tableButton]) {
    button?.classList.toggle("primary-inv", button.id === activeId);
  }
}

function renderView(elements, viewId, models) {
  const render = VIEWS[viewId];

  if (!render) {
    console.error(`Unknown model view: ${viewId}`);
    return;
  }

  setActiveView(elements, viewId);
  render(elements, models);
}

function attachViewToggle(elements, models) {
  for (const button of [elements.cardsButton, elements.tableButton]) {
    button?.addEventListener("click", () => {
      renderView(elements, button.id, models);
    });
  }
}

// ─── EMPTY STATE ────────────────────────────────────────────────────────────

function renderEmptyState(elements) {
  elements.list.className = "grid-2";
  elements.list.replaceChildren();

  appendCreateCard(elements.list, CREATE);
  clearCreateRow(elements.create);

  for (const button of [elements.cardsButton, elements.tableButton]) {
    button.hidden = true;
  }
}

// ─── INITIALISATION ─────────────────────────────────────────────────────────

async function loadModelListPage() {
  const elements = getElements();

  try {
    if (!(await isAuthenticated())) {
      showGate(elements, false);
      return;
    }

    showGate(elements, true);

    const models = await getMyModels();

    if (!models) {
      showError(
        elements.message,
        "Could not load models."
      );
      return;
    }

    if (models.length === 0) {
      renderEmptyState(elements);
      return;
    }

    const initialView =
      models.length <= MAX_CARDS
        ? "view-cards"
        : "view-table";

    renderView(elements, initialView, models);
    attachViewToggle(elements, models);
  } catch (error) {
    console.error(
      "Failed to load model list:",
      error,
    );

    showError(
        elements.message,
        "Models list page could not be loaded",
      );
    }
}

loadModelListPage();

