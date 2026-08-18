// A list of one domain's records, as cards or as a table.
//
// The page's markup needs a `#container`, and a `#gate` card if the list is private;
// everything else is rendered. A domain that passes no `table` gets cards only and no
// toggle — that's the teams list.

import { isAuthenticated } from "../api/client.js";
import { showGate } from "./gate.js";
import { applyShell } from "./shell.js";
import { showEmpty, showFailure } from "../core/utils.js";
import {
  appendCreateCard,
  clearCreateRow,
  renderCreateRow,
} from "../cards/createCard.js";
import {
  buildHeader,
  buildPage,
  renderHeader,
  renderPage,
  showPageError,
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

function renderEmptyState(elements, create, noun) {
  elements.list.className = "column gap-md";
  elements.list.replaceChildren();

  // Before the create card, and shown whether or not there is one: signed out there is no
  // card, and an empty list would otherwise be an empty page.
  showEmpty(elements.list, `No ${noun} yet.`);

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
  create: createLink,
  description = "",
  maxCards = 6,
  // False for a list the API serves to anyone. Such a page is one URL for both audiences:
  // no gate, the public shell when signed out, and no create affordance.
  requiresAuth = true,
}) {
  // The currently mounted Tabulator instance. It needs to be destroyed before
  // switching views because replacing the list's contents does not destroy it.
  let tableInstance = null;

  // The one affordance on a list page that isn't just reading it, so it stays null until
  // the sign-in state is known. Declared out here because renderView closes over it.
  let create = null;

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
    const signedIn = await isAuthenticated();

    if (requiresAuth) {
      showGate(signedIn);

      if (!signedIn) return;
    } else {
      // Only a page that can be read either way has a shell to choose; a private one is
      // written in the private shell and stays there.
      applyShell(signedIn);
    }

    create = signedIn ? createLink : null;

    renderPage(
      buildPage({
        header: buildHeader(
          table ? [CARDS_ACTION, TABLE_ACTION] : [],
        ),
        body: buildList(),
      }),
    );

    renderHeader(title, description);

    const elements = getElements();
    const items = await fetch();

    // Into the list rather than the page message: the fetch came back with nothing, so the
    // failure belongs where the rows would have been — same place as the empty state.
    if (!items) {
      showFailure(elements.list, `Loading ${noun} failed.`);
      return;
    }

    if (!items.length) {
      renderEmptyState(elements, create, noun);
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

    showPageError(`The ${noun} list page could not be loaded.`, error);
  }
}

export { loadListPage };
