// A list of one domain's records, as cards or as a table.
//
// The page's markup needs a `#container`, and a `#gate` card if the list is private;
// everything else is rendered. A domain that passes no `table` gets cards only and no
// toggle — that's the teams list.

import { isAuthenticated } from "../api/client.js";
import { getIcon } from "../components/icons.js";
import { showGate } from "./gate.js";
import { applyShell } from "./shell.js";
import { escapeHtml, showEmpty, showFailure } from "../core/utils.js";
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
const COMPARE = "list-compare";

const CARDS_ACTION = {
  id: CARDS,
  label: "Cards",
  icon: getIcon("cards"),
};

const TABLE_ACTION = {
  id: TABLE,
  label: "Table",
  icon: getIcon("table"),
};

// The create control has its own container rather than living in `#list`, which Tabulator
// owns in table view.
function buildList(compare) {
  return `
    <div id="list"></div>
    <div id="create-row"></div>
    ${compare ? `
      <section class="page-section" id="compare-section" hidden>
        <div class="row"><h2 class="section-title">${escapeHtml(compare.title)}</h2></div>
        <div class="section-body" id="compare-body"></div>
      </section>` : ""}
  `;
}

function getElements() {
  return {
    list: document.getElementById("list"),
    create: document.getElementById("create-row"),
    cardsButton: document.getElementById(CARDS),
    tableButton: document.getElementById(TABLE),
    compareButton: document.getElementById(COMPARE),
    compareSection: document.getElementById("compare-section"),
    compareBody: document.getElementById("compare-body"),
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

function renderTable(items, elements, table, create, selection) {
  elements.list.className = "";

  const tableInstance = table({
    container: elements.list,
    rows: items,
    selection,
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
  if (!create) {
    showEmpty(elements.list, `No public ${noun} yet.`);
  } else {
    appendCreateCard(elements.list, create);
    clearCreateRow(elements.create);
  }

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
  // Header links this domain offers beyond reading the list — the models list's way on to
  // the comparison page. Before the view toggle, which is about the list itself rather
  // than about going anywhere.
  actions = [],
  // Turns the list into something a reader can pick from: a button in the header, ticks in
  // the table, and whatever `create` builds underneath it. The list page owns the mode and
  // the selection; what a pick *means* is the caller's — see modelList.js.
  //
  //   { title, label, max, create({ container, onDrop }), toSeed(row) }
  //
  compare = null,
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

  // Comparing is a mode of the table view: cards have no ticks, so entering it is also what
  // switches the view. The widget is built once and kept, since it holds what it has
  // already fetched.
  let comparing = false;
  let comparison = null;

  function destroyTable() {
    tableInstance?.destroy?.();
    tableInstance = null;
  }

  // Built on the first switch into compare mode and kept: it holds whatever it has already
  // fetched, which rebuilding per selection would throw away.
  function comparisonFor(elements) {
    comparison ??= compare.create({
      container: elements.compareBody,
      onDrop: key => tableInstance?.deselectRow(key),
    });

    return comparison;
  }

  function selectionFor(elements) {
    return {
      max: compare.max,
      // The row is the control while comparing, so a click on the name in it picks the row
      // rather than leaving the page and the half-built comparison with it.
      claimLinks: true,
      onChange: async rows => {
        const overflow = await comparisonFor(elements).show(rows.map(compare.toSeed));

        // Tabulator caps selection by click but refuses the extra one silently; handing it
        // back is what keeps the ticks and the comparison saying the same thing.
        for (const key of overflow) tableInstance?.deselectRow(key);
      },
    };
  }

  function setComparing(next, elements, items) {
    comparing = next;

    elements.compareButton.classList.toggle("primary-inv", comparing);
    elements.compareSection.hidden = !comparing;

    // The table is rebuilt either way: whether its rows can be picked is a constructor
    // option, and Tabulator reads those once.
    renderView(elements, TABLE, items);

    if (comparing) comparisonFor(elements).clear();
    else comparison?.clear();
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
        comparing ? selectionFor(elements) : null,
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
        header: buildHeader([
          ...actions,
          // Before the view toggle: it is what the reader came to do, where the toggle is
          // how they want to look at the list while doing it.
          ...(compare ? [{ id: COMPARE, label: compare.label, icon: getIcon("compare") }] : []),
          ...(table ? [CARDS_ACTION, TABLE_ACTION] : []),
        ]),
        body: buildList(compare),
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
        // Leaving the table leaves the mode with it: there is nothing to tick on a card.
        if (comparing && button.id === CARDS) setComparing(false, elements, items);
        else renderView(elements, button.id, items);
      });
    }

    elements.compareButton?.addEventListener("click", () => {
      setComparing(!comparing, elements, items);
    });
  } catch (error) {
    console.error(`Failed to load the ${noun} list:`, error);

    showPageError(`The ${noun} list page could not be loaded.`, error);
  }
}

export { loadListPage };
