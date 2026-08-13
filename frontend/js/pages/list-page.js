// A list of one domain's records, as cards or as a table.
//
// The page's markup needs a `#gate` card and a `#container`, same as a record page;
// everything else is rendered. A domain that passes no `table` gets cards only and no
// toggle — that's the teams list.

import { isAuthenticated } from "../api.js";
import { showGate } from "../utils/gate.js";
import { showError } from "../utils.js";
import {
  appendCreateCard,
  clearCreateRow,
  renderCreateRow,
} from "../utils/create-card.js";
import {
  buildHeader,
  buildMessage,
  buildPage,
  pageMessage,
  renderHeader,
  renderPage,
} from "./record-page.js";

const CARDS = "view-cards";
const TABLE = "view-table";

const CARDS_ACTION = {
  id: CARDS,
  label: "Cards",
  icon: "layout-grid",
};

const TABLE_ACTION = {
  id: TABLE,
  label: "Table",
  icon: "table",
};

// The create control has its own container rather than living in `#list`, which Tabulator
// owns in table view.
function buildList() {
  return `
    <div id="list"></div>
    <div id="create-row"></div>
  `;
}

function getElements() {
  return {
    list: document.getElementById("list"),
    create: document.getElementById("create-row"),
    cardsButton: document.getElementById(CARDS),
    tableButton: document.getElementById(TABLE),
  };
}

function setActiveView(activeId, elements) {
  for (const button of [
    elements.cardsButton,
    elements.tableButton,
  ]) {
    button?.classList.toggle(
      "primary-inv",
      button.id === activeId,
    );
  }
}

function renderCards(items, elements, cards, create) {
  elements.list.className = "grid-2";
  elements.list.innerHTML = cards(items);

  // The create card is part of the grid, so it becomes the final cell.
  appendCreateCard(elements.list, create);
  clearCreateRow(elements.create);
}

function renderTable(items, elements, table, create) {
  elements.list.className = "";

  const tableInstance = table({
    container: elements.list,
    rows: items,
  });

  // Tabulator owns the list container, so the create control lives below it.
  renderCreateRow(elements.create, create);

  return tableInstance ?? null;
}

function renderEmptyState(elements, create) {
  elements.list.className = "grid-2";
  elements.list.replaceChildren();

  appendCreateCard(elements.list, create);
  clearCreateRow(elements.create);

  for (const button of [
    elements.cardsButton,
    elements.tableButton,
  ]) {
    if (button) {
      button.hidden = true;
    }
  }

  globalThis.lucide?.createIcons?.();
}

function getInitialView(items, table, maxCards) {
  return table && items.length > maxCards ? TABLE : CARDS;
}

async function loadListPage({
  title,
  noun,
  fetch,
  cards,
  table = null,
  create,
  description = "",
  maxCards = 6,
}) {
  const gate = document.getElementById("gate");

  // The currently mounted Tabulator instance. It needs to be destroyed before
  // switching views because replacing the list's contents does not destroy it.
  let tableInstance = null;

  function destroyTable() {
    tableInstance?.destroy?.();
    tableInstance = null;
  }

  function renderView(elements, viewId, items) {
    destroyTable();
    setActiveView(viewId, elements);

    if (viewId === TABLE) {
      tableInstance = renderTable(
        items,
        elements,
        table,
        create,
      );
    } else {
      renderCards(
        items,
        elements,
        cards,
        create,
      );
    }

    globalThis.lucide?.createIcons?.();
  }

  try {
    if (!(await isAuthenticated())) {
      showGate({ gate }, false);
      return;
    }

    showGate({ gate }, true);

    renderPage(
      buildPage({
        header: buildHeader(
          table ? [CARDS_ACTION, TABLE_ACTION] : [],
        ),
        body: buildMessage() + buildList(),
      }),
    );

    renderHeader(title, description);

    const elements = getElements();
    const items = await fetch();

    if (!items) {
      showError(pageMessage(), `Could not load ${noun}.`);
      return;
    }

    if (!items.length) {
      renderEmptyState(elements, create);
      return;
    }

    renderView(elements,
      getInitialView(items, table, maxCards),
      items,
    );

    for (const button of [
      elements.cardsButton,
      elements.tableButton,
    ]) {
      button?.addEventListener("click", () => {
        renderView(elements, button.id, items);
      });
    }
  } catch (error) {
    console.error(`Failed to load the ${noun} list:`, error);

    showError(
      pageMessage() ?? gate,
      `The ${noun} list page could not be loaded.`,
    );
  }
}

export { loadListPage };
