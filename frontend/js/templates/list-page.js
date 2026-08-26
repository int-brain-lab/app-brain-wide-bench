// Template for list pages.
//
// One list, read two ways: a grid of cards or a table. Above them is one bar of filters,
// owned here rather than by either view, so what the reader narrowed to survives the switch
// between them — and below them the create control, on the pages where signing in gives one.
// The default view is the table once there are more than `maxCards` records.
//
// Both views page: the table through Tabulator, the cards through cards/cardGrid.js.
//
// Everything the two views share is held here rather than derived from whichever is on
// screen — the filter values, the page, and the set of records picked for a comparison.
// That is what lets compare mode work in either view, and what keeps a pick made in the
// table from vanishing when the reader filters it out of sight or switches to the cards.
//
// The boot half — gate, shell, load, and the words each failure is reported in — is
// page-loader.js, shared with the record pages.
//
// The page's markup needs a `#container`, and a `#gate` card if the list is private;
// everything else is rendered. A domain that passes no `table` gets cards only and no
// toggle — that's the teams list.

import { renderCardGrid, markCardSelection } from "../cards/cardGrid.js";
import { renderCreateRow } from "../cards/createCard.js";
import { buildFilterBar, createFilterState } from "../components/filters.js";
import { getIcon } from "../components/icons.js";
import { escapeHtml, showEmpty } from "../core/utils.js";
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
    ${compare ? `
      <section class="page-section" id="compare-section" hidden>
        <div class="row"><h2 class="section-title">${escapeHtml(compare.title)}</h2></div>
        <div class="section-body" id="compare-body"></div>
      </section>` : ""}
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

function renderEmptyState(elements, create, noun) {
  elements.list.className = "column gap-md";
  elements.list.replaceChildren();

  // Signed out there is no create control, and an empty list would otherwise be an empty
  // page. Signed in the control is the whole of the empty state, as it has always been.
  if (!create) {
    showEmpty(elements.list, `No public ${noun} yet.`);
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
  toRows = records => records,
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
  // rows or cards, and whatever `create` builds underneath it. The list page owns the mode
  // and the selection; what a pick *means* is the caller's — see modelList.js.
  //
  //   { title, label, max, create({ container, onDrop }), toSeed(row) }
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

  // Comparing is a mode of either view. The widget is built once and kept, since it holds
  // what it has already fetched.
  let comparing = false;
  let comparison = null;

  // The comparison's contents, held here rather than read back off whichever view is on
  // screen: the cards don't know about the table's ticks, and the table forgets everything
  // when it is rebuilt for the other view. Insertion order is the order they were picked,
  // which is the order the comparison reads them in.
  const picked = new Set();
  let seeds = new Map();

  // Set while we push `picked` back into a freshly mounted table, so the selection events
  // that causes aren't mistaken for the reader picking those rows again.
  let syncing = false;

  function destroyTable() {
    tableInstance?.destroy?.();
    tableInstance = null;
  }

  // Built on the first switch into compare mode and kept: it holds whatever it has already
  // fetched, which rebuilding per selection would throw away.
  function comparisonFor() {
    comparison ??= compare.create({
      container: elements.compareBody,
      onDrop: key => drop(key),
    });

    return comparison;
  }

  async function updateComparison() {
    const overflow = await comparisonFor().show([...picked].map(key => seeds.get(key)));

    // The table caps selection by click but refuses the extra one silently; handing it back
    // is what keeps the ticks and the comparison saying the same thing. `forget` rather than
    // `drop`: these never made it into the comparison, so it has nothing to be told about.
    for (const key of overflow) forget(key);
  }

  // Unpick a record everywhere it is shown. Deselecting the row would ordinarily be enough —
  // the selection event is what drives everything else — but not while `syncing` is set, and
  // this is one of the two callers that sets it.
  function forget(key) {
    picked.delete(key);

    if (tableInstance) {
      syncing = true;
      tableInstance.deselectRow(key);
      syncing = false;
    } else {
      markCardSelection(elements.list, picked);
    }
  }

  // The ✕ on a model in the comparison itself. The widget doesn't remove it — the selection
  // isn't its to change — so it hands the key back and waits to be shown the rest.
  function drop(key) {
    forget(key);
    updateComparison();
  }

  function toggle(key) {
    if (picked.has(key)) picked.delete(key);
    else picked.add(key);

    markCardSelection(elements.list, picked);
    updateComparison();
  }

  // A table mounted mid-comparison starts with nothing selected, and one that was filtered
  // may have dropped rows that are still in the comparison. Either way `picked` is the
  // record, so it is re-asserted rather than read.
  function syncTableSelection() {
    if (!tableInstance || !comparing) return;

    syncing = true;
    for (const key of picked) tableInstance.selectRow(key);
    syncing = false;
  }

  function selectionFor() {
    return {
      max: compare.max,
      // The row is the control while comparing, so a click on the name in it picks the row
      // rather than leaving the page and the half-built comparison with it.
      claimLinks: true,
      // What changed rather than what is now selected: a row filtered out of the table is
      // still in the comparison, and reading the whole selection back would drop it.
      onChange: (_data, { selected, deselected }) => {
        if (syncing) return;

        for (const row of selected) picked.add(compare.toSeed(row.getData()).key);
        for (const row of deselected) picked.delete(compare.toSeed(row.getData()).key);

        updateComparison();
      },
    };
  }

  function setComparing(next) {
    comparing = next;

    elements.compareButton.classList.toggle("primary-inv", comparing);
    elements.compareSection.hidden = !comparing;

    // Leaving the mode leaves the picks with it — the comparison below is gone, so ticks
    // pointing at it would point at nothing.
    if (!comparing) picked.clear();

    // The view is redrawn either way: whether its rows or its cards can be picked is settled
    // when they are drawn — for the table by a constructor option, which Tabulator reads once.
    renderView(currentView);

    if (comparing) comparisonFor().clear();
    else comparison?.clear();
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
      onPage: page => {
        cardPage = page;
        renderCards();
      },
      selection: comparing
        ? { keys: picked, max: compare.max, onToggle: toggle }
        : null,
      keyOf: row => compare?.toSeed(row).key ?? row.id,
    });
  }

  function renderTable() {
    elements.list.className = "";

    tableInstance = table({
      container: elements.list,
      rows,
      selection: comparing ? selectionFor() : null,
    }) ?? null;

    // Tabulator builds its DOM asynchronously, so neither the filter nor the selection can
    // be applied to the instance the constructor just returned.
    tableInstance?.on("tableBuilt", () => {
      applyTableFilter();
      syncTableSelection();
    });
  }

  function applyTableFilter() {
    // Filtered rather than handed a filtered copy of the data: the rows behind the picks
    // have to stay in the table, or narrowing the list would empty the comparison.
    if (tableInstance && filterState) tableInstance.setFilter(filterState.matches);
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

    if (currentView === TABLE) {
      applyTableFilter();
      syncTableSelection();
    } else {
      renderCards();
    }
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
            ...(compare ? [{ id: COMPARE, label: compare.label, icon: getIcon("compare") }] : []),
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

      if (compare) {
        seeds = new Map(rows.map(row => {
          const seed = compare.toSeed(row);

          return [seed.key, seed];
        }));
      }

      renderFilterBar();
      renderView(getInitialView(rows, table, maxCards));

      for (const button of [
        elements.cardsButton,
        elements.tableButton,
      ]) {
        button?.addEventListener("click", () => renderView(button.id));
      }

      elements.compareButton?.addEventListener("click", () => setComparing(!comparing));
    },
  });
}

export { loadListPage };
