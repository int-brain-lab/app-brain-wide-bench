// Template for list pages.
//
// One list, read two ways: a grid of cards or a table. Above them is one bar of filters,
// owned here rather than by either view, so what the reader narrowed to survives the switch
// between them — and below them the create control, on the pages where signing in gives one.
// The default view is the table once there are more than `maxCards` records.
//
// Both views page: the table through Tabulator, the cards through cards/cardGrid.js.
//
// What the two views share is held apart from both of them rather than read back off
// whichever is on screen: the filter values and the card page here, and what is picked for a
// comparison in the comparison itself. That is what lets compare mode work in either view,
// and what keeps a pick made in the table from vanishing when the reader filters it out of
// sight or switches to the cards.
//
// The boot half — gate, shell, load, and the words each failure is reported in — is
// page-loader.js, shared with the record pages.
//
// The page's markup needs a `#container`, and a `#gate` card if the list is private;
// everything else is rendered. A domain that passes no `table` gets cards only and no
// toggle — that's the teams list.

import { renderCardGrid } from "../cards/cardGrid.js";
import { renderCreateRow } from "../cards/createCard.js";
import { buildFilterBar, createFilterState } from "../components/filters.js";
import { getIcon } from "../components/icons.js";
import { dispose } from "../core/disposable.js";
import { escapeHtml, showEmpty } from "../core/utils.js";
import { bindCards, bindTable } from "../widgets/comparison.js";
import { loadPage } from "./page-loader.js";
import {
  buildHeader,
  buildPage,
  renderHeader,
  renderPage,
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

// The filter bar has its own container rather than living in `#list`, which each view
// replaces wholesale — and Tabulator owns outright in table view. The create control has one
// for the same reason.
function buildList(compare) {
  return `
    <div id="filters"></div>
    <div id="list"></div>
    <div id="create-row"></div>
    ${
      compare
        ? `
      <section class="page-section" id="compare-section" hidden>
        <div class="row"><h2 class="section-title">${escapeHtml(compare.title)}</h2></div>
        <div class="section-body" id="compare-body"></div>
      </section>`
        : ""
    }
  `;
}

function getElements() {
  return {
    filters: document.getElementById("filters"),
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
  for (const button of [elements.cardsButton, elements.tableButton]) {
    button?.classList.toggle("primary-inv", button.id === activeId);
  }
}

function renderEmptyState(elements, create, noun) {
  elements.list.className = "column gap-md";
  elements.list.replaceChildren();

  // Signed out there is no create control, and an empty list would otherwise be an empty
  // page. Signed in the control is the whole of the empty state, as it has always been.
  if (!create) {
    showEmpty(elements.list, `No public ${noun} yet.`);
  }

  for (const button of [elements.cardsButton, elements.tableButton]) {
    if (button) {
      button.hidden = true;
    }
  }

  globalThis.lucide?.createIcons?.();
}

function getInitialView(rows, table, maxCards) {
  return table && rows.length > maxCards ? TABLE : CARDS;
}

function loadListPage({
  title,
  noun,
  fetch,
  cards,
  // Maps the records the fetch returned to the row shape everything else here works in: the
  // cards render from it, the filters match against it, and the table is built from it. One
  // shape rather than two is what lets one filter bar serve both views.
  toRows = (records) => records,
  table = null,
  create: createLink,
  description = "",
  // (rows) => controls, as components/filters.js describes them. A function because a
  // select's options are often whatever the rows happen to contain — see optionsFromRows.
  filters = null,
  // Header links this domain offers beyond reading the list — the models list's way on to
  // the comparison page. Before the view toggle, which is about the list itself rather
  // than about going anywhere.
  actions = [],
  // Turns the list into something a reader can pick from: a button in the header, pickable
  // rows or cards, and a comparison underneath. The page owns the mode; the comparison owns
  // what is picked — see widgets/comparison.js — and what a pick *means* is the caller's.
  //
  //   { title, label, create(options), toEntry(row) }
  //
  compare = null,
  maxCards = 6,
  cardsPerPage = 8,
  // False for a list the API serves to anyone. Such a page is one URL for both audiences:
  // no gate, the public shell when signed out, and no create affordance.
  requiresAuth = true,
}) {
  // The currently mounted Tabulator instance. It needs to be destroyed before
  // switching views because replacing the list's contents does not destroy it.
  let tableInstance = null;

  // The one affordance on a list page that isn't just reading it, so it stays null until
  // the sign-in state is known.
  let create = null;

  let elements = null;
  let currentView = CARDS;

  // Every row, and the ones the filter bar left. The table filters its own copy through
  // Tabulator — the cards are sliced out of `filtered` here.
  let rows = [];
  let filtered = [];
  let filterState = null;
  let cardPage = 1;

  // Comparing is a mode of either view. The comparison is built once and kept, since it
  // holds what it has already fetched — and it holds the picks, which is what lets them
  // survive a filter, a page of cards, and the switch between the two views.
  let comparing = false;
  let comparison = null;

  // One per view, bound to the comparison. Only the mounted one is attached; the other's
  // pushes go nowhere.
  let tableView = null;
  let cardView = null;

  function destroyTable() {
    dispose(tableInstance);
    tableInstance = null;
  }

  // Built on the first switch into compare mode, and kept from then on.
  function comparisonFor() {
    if (!comparison) {
      comparison = compare.create({
        container: elements.compareBody,
        toEntry: compare.toEntry,
      });

      tableView = bindTable(comparison);
      cardView = bindCards(comparison);
    }

    return comparison;
  }

  function setComparing(next) {
    comparing = next;

    elements.compareButton.classList.toggle("primary-inv", comparing);
    elements.compareSection.hidden = !comparing;

    // Either way the comparison is emptied — leaving the mode takes the picks with it, since
    // the comparison below is gone and ticks pointing at it would point at nothing, and
    // entering it puts the comparison's own invitation on screen.
    if (comparing) comparisonFor().clear();
    else comparison?.clear();

    // The view is redrawn either way: whether its rows or its cards can be picked is settled
    // when they are drawn — for the table by a constructor option, which Tabulator reads once.
    renderView(currentView);
  }

  function renderCards() {
    cardPage = renderCardGrid({
      container: elements.list,
      rows: filtered,
      cards,
      total: rows.length,
      // The tables' footers say "Showing 8 out of 25 models", and this is the same footer.
      // They are handed the singular and add the "s"; a list page names itself in the plural.
      noun: noun.replace(/s$/, ""),
      page: cardPage,
      pageSize: cardsPerPage,
      onPage: (page) => {
        cardPage = page;
        renderCards();
      },
      selection: comparing ? cardView.selection() : null,
      keyOf: (row) => (comparing ? comparison.keyOf(row) : row.id),
    });

    cardView?.attach(comparing ? elements.list : null);
    tableView?.attach(null);
  }

  function renderTable() {
    elements.list.className = "";

    tableInstance =
      table({
        container: elements.list,
        rows,
        selection: comparing ? tableView.selection() : null,
      }) ?? null;

    // Tabulator builds its DOM asynchronously, so the filter can't be applied to the
    // instance the constructor just returned. The binding hangs off the same event for the
    // ticks, and is attached after this so it reconciles against filtered rows.
    tableInstance?.on("tableBuilt", applyTableFilter);

    cardView?.attach(null);
    tableView?.attach(comparing ? tableInstance : null);
  }

  function applyTableFilter() {
    // Filtered rather than handed a filtered copy of the data: the rows behind the picks
    // have to stay in the table, or narrowing the list would empty the comparison.
    if (!tableInstance || !filterState) return;

    const filter = () => tableInstance.setFilter(filterState.matches);

    // Guarded while comparing: if narrowing the list takes a picked row out of sight and
    // Tabulator unticks it, that is the table changing its mind about the selection rather
    // than the reader, and the comparison is the record of it.
    if (comparing && tableView) tableView.apply(filter);
    else filter();
  }

  function renderView(viewId) {
    destroyTable();

    currentView = viewId;
    setActiveView(viewId, elements);

    if (viewId === TABLE) renderTable();
    else renderCards();

    globalThis.lucide?.createIcons?.();
  }

  function applyFilters() {
    filtered = rows.filter(filterState.matches);

    // The page the reader was on may not exist in the narrowed list; cardGrid clamps it, but
    // the first page is where they expect to land after changing what they are looking at.
    cardPage = 1;

    if (currentView === TABLE) applyTableFilter();
    else renderCards();
  }

  function renderFilterBar() {
    if (!filters) return;

    const controls = filters(rows);

    elements.filters.innerHTML = buildFilterBar(controls);

    filterState = createFilterState({
      controls,
      root: elements.filters,
      onChange: applyFilters,
    });
  }

  return loadPage({
    // The list rather than the record: "The models list page could not be loaded."
    noun: `${noun} list`,
    requiresId: false,
    requiresAuth,
    load: () => fetch(),

    render: (records, { signedIn }) => {
      create = signedIn ? createLink : null;

      renderPage(
        buildPage({
          header: buildHeader([
            ...actions,
            // Before the view toggle: it is what the reader came to do, where the toggle is
            // how they want to look at the list while doing it.
            ...(compare
              ? [
                  {
                    id: COMPARE,
                    label: compare.label,
                    icon: getIcon("compare"),
                  },
                ]
              : []),
            ...(table ? [CARDS_ACTION, TABLE_ACTION] : []),
          ]),
          body: buildList(compare),
        }),
      );

      renderHeader(title, description);

      elements = getElements();

      // Below the list in both views, so one placement holds wherever the reader is and
      // whichever page of the cards they are on.
      renderCreateRow(elements.create, create);

      if (!records.length) {
        renderEmptyState(elements, create, noun);
        return;
      }

      rows = toRows(records);
      filtered = rows;

      renderFilterBar();
      renderView(getInitialView(rows, table, maxCards));

      for (const button of [elements.cardsButton, elements.tableButton]) {
        button?.addEventListener("click", () => renderView(button.id));
      }

      elements.compareButton?.addEventListener("click", () =>
        setComparing(!comparing),
      );
    },
  });
}

export { loadListPage };
