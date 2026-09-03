// A list view over one set of rows, with optional cards, table, filtering and a secondary
// panel driven by selection.
//
// Cards and table share the same rows, filter state and selection. The optional panel has
// two modes: `base` and `active`. Views are created lazily and kept alive so switching
// between cards/table or modes does not lose the user's state.

import { buildFilterBar, createFilterState } from "../components/filters.js";
import { resolveContainer } from "../core/dom.js";
import { buildSection } from "../components/sections.js";
import {
  buildCardTableToggle,
  buildCompareButton,
  CARD_TOGGLE_ID,
  COMPARE_BUTTON_ID,
  TABLE_TOGGLE_ID,
} from "../components/buttons.js";
import { dispose } from "../core/disposable.js";
import { refreshIcons, renderHtml } from "../core/render.js";
import {
  bindCardSelection,
  bindTableSelection,
  createPicker,
} from "../comparisons/comparison.js";

const MODE_NAMES = ["base", "active"];

// ─── LIST VIEW ───────────────────────────────────────────────────────────────

/**
 * A list in its two views, cards and a table, over one set of rows and one filter bar.
 *
 * @param container      element, or the id of one. Its contents are replaced, and it is
 *                       written into before the panels are built rather than after — a panel
 *                       is a widget that looks its own controls up by document id the moment
 *                       it is created, and getElementById finds nothing in a detached tree.
 * @param rows           every row, already mapped. The host handles an empty list.
 * @param createCards    () => a card grid — see cards/cardGrid.js. Omit for a table-only
 *                       list.
 * @param createTable    ({ rows, selection }) => { element, table } — see tables/table.js.
 * @param filterControls (rows) => controls for the bar — see components/filters.js. Omit
 *                       for no filter bar.
 * @param modes          `{ base, active }` panel definitions. Omit for a list whose rows
 *                       open nothing beside them.
 * @param picking        `{ max, palette, label, toEntry, onCompare }` for a list whose rows are
 *                       picked and then acted on elsewhere, rather than opening a panel beside
 *                       them: a click highlights a row, at most `max` are held, and the button
 *                       calls `onCompare(keys)` with what is picked. The record's own link
 *                       still navigates — the row is the pick, the name is the way to the
 *                       record. `palette` marks each pick in the colour it will be drawn in
 *                       wherever it is handed on. Takes the place of `modes`: a list cannot
 *                       both hand its picks on and draw a panel from them.
 * @param maxCards       rows at or below which the list opens on the cards rather than the
 *                       table.
 *
 * @returns `{ element, destroy }`. `element` is the list's own, already placed in
 *          `container`.
 */
function createListView({
  container,
  rows,
  createCards = null,
  createTable,
  filterControls = null,
  modes = {},
  picking = null,
  maxCards = 6,
}) {
  const element = document.createElement("div");

  element.className = "column gap-md";

  let currentView = getInitialView();
  let activeMode = modes.base ? "base" : null;
  let filterState = null;

  let cardView = null;
  let tableView = null;

  // Mode name -> { controller, table, cards }.
  const panels = new Map();

  // The picks, as the same shape a panel presents: a controller and the two bindings that keep
  // the table and the cards showing what it holds. There is nothing to render from it, so it
  // is not in `panels` and has no section — everything else about it is a panel, which is what
  // lets the table, the cards and the filtering below stay as they are.
  const picker = picking
    ? (() => {
        const controller = createPicker({
          max: picking.max,
          palette: picking.palette,
          toEntry: picking.toEntry,
        });

        return {
          controller,
          // The row is the pick and the record's own name is the link out of the list, so a
          // click on the name follows it and leaves the picks alone.
          table: bindTableSelection(controller, { claimLinks: false }),
          cards: createCards ? bindCardSelection(controller) : null,
        };
      })()
    : null;

  // ─── VIEW ──────────────────────────────────────────────────────────────────

  function getInitialView() {
    return createCards && rows.length <= maxCards
      ? CARD_TOGGLE_ID
      : TABLE_TOGGLE_ID;
  }

  function getSlot(selector) {
    return element.querySelector(selector);
  }

  function setActiveView(view) {
    for (const button of [
      getSlot(`#${CARD_TOGGLE_ID}`),
      getSlot(`#${TABLE_TOGGLE_ID}`),
    ]) {
      button?.classList.toggle("primary-inv", button.id === view);
    }
  }

  function renderView(view) {
    currentView = createCards ? view : TABLE_TOGGLE_ID;

    setActiveView(currentView);

    if (currentView === TABLE_TOGGLE_ID) {
      showTable();
    } else {
      showCards();
    }

    refreshIcons();
  }

  // ─── MODES ─────────────────────────────────────────────────────────────────

  function panelId(mode) {
    return `panel-${mode}`;
  }

  function ensurePanel(mode) {
    if (!mode) return null;

    const existing = panels.get(mode);
    if (existing) return existing;

    const {
      create,
      bindTable = bindTableSelection,
      bindCards = bindCardSelection,
    } = modes[mode];

    const controller = create(getSlot(`#section-${panelId(mode)}-body`));

    const panel = {
      controller,
      table: bindTable(controller),
      cards: createCards ? bindCards(controller) : null,
    };

    panels.set(mode, panel);

    return panel;
  }

  function activePanel() {
    return picker ?? ensurePanel(activeMode);
  }

  function showMode(mode) {
    for (const name of MODE_NAMES) {
      const pane = getSlot(`#section-${panelId(name)}`);

      if (pane) {
        pane.hidden = name !== mode;
      }
    }
  }

  function attachActiveCardSelection() {
    for (const panel of panels.values()) {
      panel.cards?.attach(null);
    }

    if (!cardView) return;

    const panel = activePanel();

    panel?.cards?.attach(cardView.element);
    cardView.setSelection(panel?.cards?.selection() ?? null);
  }

  function setMode(mode) {
    activeMode = mode;

    showMode(mode);
    activePanel()?.controller.clear();

    attachActiveCardSelection();

    // Table selection behaviour is fixed when the table is created. Recreate it when the
    // active mode changes so the new mode gets the correct selection synchronisation.
    destroyTable();

    renderView(currentView);
  }

  // ─── CARDS ─────────────────────────────────────────────────────────────────

  function ensureCardView() {
    if (cardView) return cardView;

    cardView = createCards();

    cardView.setRows(rows);

    if (filterState) {
      cardView.setFilter(filterState.matches);
    }

    const panel = activePanel();

    cardView.setSelection(panel?.cards?.selection() ?? null);
    panel?.cards?.attach(cardView.element);

    return cardView;
  }

  function showCards() {
    getSlot("[data-role='list']").replaceChildren(ensureCardView().element);
  }

  // ─── TABLE ─────────────────────────────────────────────────────────────────

  function ensureTableView() {
    if (tableView) return tableView;

    const panel = activePanel();

    tableView = createTable({
      rows,
      selection: panel?.table?.selection() ?? null,
    });

    panel?.table?.attach(tableView.table);

    tableView.table?.on("tableBuilt", applyTableFilter);

    return tableView;
  }

  function showTable() {
    const alreadyBuilt = Boolean(tableView);

    getSlot("[data-role='list']").replaceChildren(ensureTableView().element);

    // A detached table has no usable dimensions. Redraw when putting an existing table back
    // into the document.
    if (alreadyBuilt) {
      tableView.table.redraw(true);
    }
  }

  function destroyTable() {
    for (const panel of panels.values()) {
      panel.table?.attach(null);
    }

    dispose(tableView?.table);
    tableView = null;
  }

  // ─── FILTERING ─────────────────────────────────────────────────────────────

  function applyFilters() {
    cardView?.setFilter(filterState.matches);
    applyTableFilter();
  }

  function applyTableFilter() {
    if (!tableView?.table || !filterState) return;

    const apply = () => {
      tableView.table.setFilter(filterState.matches);
    };

    const tableSelection = activePanel()?.table;

    if (tableSelection) {
      tableSelection.apply(apply);
    } else {
      apply();
    }
  }

  // ─── EVENTS ────────────────────────────────────────────────────────────────

  // Nothing to hand on until something is picked. Judged from the picker rather than from the
  // rows, since a filter that hides a picked row does not unpick it.
  function updateCompareButton() {
    const button = getSlot(`#${COMPARE_BUTTON_ID}`);

    if (button) button.disabled = picker.controller.size === 0;
  }

  function attachEvents() {
    getSlot(`#${CARD_TOGGLE_ID}`)?.addEventListener("click", () =>
      renderView(CARD_TOGGLE_ID),
    );

    getSlot(`#${TABLE_TOGGLE_ID}`)?.addEventListener("click", () =>
      renderView(TABLE_TOGGLE_ID),
    );

    // The same button, two jobs: it opens the comparison panel where there is one, and hands
    // the picks to the caller where the list is a picker.
    getSlot(`#${COMPARE_BUTTON_ID}`)?.addEventListener("click", () => {
      if (picker) picking.onCompare(picker.controller.keys());
      else toggleComparison();
    });
  }

  function toggleComparison() {
    const compareButton = getSlot(`#${COMPARE_BUTTON_ID}`);
    const comparing = activeMode !== "active";
    const nextMode = comparing ? "active" : modes.base ? "base" : null;

    setMode(nextMode);
    compareButton?.classList.toggle("primary", comparing);
  }

  // ─── MARKUP ────────────────────────────────────────────────────────────────

  function buildToolbar() {
    const toggle = createCards ? buildCardTableToggle() : "";

    const action = picking ?? modes.active;

    const compare = action
      ? buildCompareButton({
          label: action.label,
          // A picker starts with nothing picked, so its button starts with nothing to do.
          disabled: Boolean(picking),
        })
      : "";

    if (!toggle && !compare) return "";

    const alignment = toggle ? "row" : "row right";

    return `<div class="${alignment} gap-sm">${toggle}${compare}</div>`;
  }

  function buildPanes() {
    return MODE_NAMES.filter((name) => modes[name])
      .map((name) =>
        buildSection({
          id: panelId(name),
          title: modes[name].title ?? "",
          hidden: true,
        }),
      )
      .join("");
  }

  function buildFilters() {
    if (!filterControls) return "";

    const controls = filterControls(rows);

    return `
      <div id="filters">
        ${buildFilterBar(controls)}
      </div>
    `;
  }

  function buildViewBody() {
    return `
      ${buildToolbar()}
      ${buildFilters()}
      <div data-role="list"></div>
      ${buildPanes()}
    `;
  }

  // ─── LIFECYCLE ─────────────────────────────────────────────────────────────

  renderHtml(element, buildViewBody());

  // Before anything below it runs: setMode builds the panel for the mode a list opens on, and
  // a panel finds its own controls with getElementById — which answers nothing until this
  // element is in the document. See the note on `container` above.
  resolveContainer(container).replaceChildren(element);

  if (filterControls) {
    filterState = createFilterState({
      controls: filterControls(rows),
      root: getSlot("#filters"),
      onChange: applyFilters,
    });
  }

  attachEvents();
  setMode(activeMode);

  // After the toolbar exists, and for as long as the list does: the picks are the only thing
  // that decides whether the button can be pressed.
  picker?.controller.subscribe(updateCompareButton);

  function destroy() {
    destroyTable();
    cardView?.destroy();

    for (const panel of panels.values()) {
      dispose(panel.controller);
    }
  }

  return { element, destroy };
}

export { createListView };
