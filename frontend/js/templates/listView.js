// A list view over one set of rows, with optional cards, table, filtering and a comparison
// the rows are picked for.
//
// Cards and table share the same rows, the same filter state and the same picks. Each view is
// built when it is first shown and kept alive, so switching between them loses nothing.
//
// The rows are not pickable until the reader asks for it: Compare turns picking on, Go takes
// the picks where they are read — the panel under the list, or a page of its own — and Done
// gives them up again. The same three the leaderboard has, which is the other list in the app
// whose rows are picked.

import { buildFilterBar } from "../components/filters.js";
import { createFilterState } from "../components/filterState.js";
import { resolveContainer } from "../core/dom.js";
import { buildSection } from "../components/sections.js";
import {
  buildButton,
  buildCardTableToggle,
  buildCompareButton,
  setButtonLabel,
  CARD_TOGGLE_ID,
  COMPARE_BUTTON_ID,
  DONE_LABEL,
  GO_BUTTON_ID,
  GO_COMPARE_LABEL,
  TABLE_TOGGLE_ID,
} from "../components/buttons.js";
import { getIcon } from "../components/icons.js";
import { dispose } from "../core/disposable.js";
import { refreshIcons, renderHtml, setText } from "../core/render.js";
import { pluralise } from "../core/utils.js";
import {
  createCardBinding,
  createTableBinding,
} from "../comparisons/binding.js";
import { createPicks } from "../comparisons/picks.js";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

// The section the comparison is drawn into, under the list.
const PANEL_ID = "panel";

// The line beside the buttons saying what they are for — see getHint.
const HINT_ID = "list-hint";

// What Go reads once the panel is open, being the only way to fold it away again.
const HIDE_LABEL = "Hide comparison";

// ─── LIST VIEW ───────────────────────────────────────────────────────────────

/**
 * A list in its two views, cards and a table, over one set of rows and one filter bar.
 *
 * @param container      element, or the id of one. Its contents are replaced, and it is
 *                       written into before the panel is built rather than after — a panel is
 *                       a widget that looks its own controls up by document id the moment it
 *                       is created, and getElementById finds nothing in a detached tree.
 * @param rows           every row, already mapped. The host handles an empty list.
 * @param noun           *singular* — "model". What the hint calls the rows, and what the
 *                       Compare button is named after.
 * @param createCards    () => a card grid — see cards/cardGrid.js. Omit for a table-only
 *                       list.
 * @param createTable    ({ rows, selection }) => { element, table } — see tables/table.js.
 * @param filterControls (rows) => controls for the bar, read once — see
 *                       components/filterState.js. Omit for no filter bar.
 * @param panel          `{ title, label, always, create }` — the comparison drawn from the
 *                       picks, in a section under the list that Go opens. `create(container)`
 *                       returns the controller holding the picks. `always: true` for a list
 *                       that is only ever picking: no buttons, the rows live from the first
 *                       render, and the panel appears as soon as one is ticked. Omit `panel`
 *                       for a list whose rows open nothing beside them.
 * @param picking        `{ max, palette, label, toPick, onCompare }` for a list that hands its
 *                       picks on instead of drawing them: `onCompare(keys)` is what Go calls,
 *                       and `palette` marks each pick in the colour it will be drawn in
 *                       wherever it lands. Takes the place of `panel`: a list cannot both hand
 *                       its picks on and draw a panel from them.
 * @param maxCards       rows at or below which the list opens on the cards rather than the
 *                       table.
 *
 * @returns `{ element, destroy }`. `element` is the list's own, already placed in
 *          `container`.
 */
function createListView({
  container,
  rows,
  noun = "row",
  createCards = null,
  createTable,
  filterControls = null,
  panel = null,
  picking = null,
  maxCards = 6,
}) {
  const element = document.createElement("div");

  element.className = "column gap-lg";

  let currentView = getInitialView();

  // A list that is only ever picking — a scores list, whose whole point is the comparison
  // under it. No button to press first, and nothing to press to stop.
  const alwaysPicking = Boolean(panel?.always);

  // Whether a click on a row picks it. Off until the reader asks to compare: on a list they
  // are reading, a click on a row means nothing.
  let comparing = alwaysPicking;

  // Whether the comparison under the list is on screen. A list that hands its picks to a page
  // of its own has no panel and never shows one.
  let showingPanel = false;

  // Whether there is anything to compare at all, which is what puts the buttons on the page.
  const comparable = Boolean(panel || picking);

  const compareLabel =
    picking?.label ?? panel?.label ?? `Compare ${pluralise(noun)}`;

  // Once, not per use: the bar's markup and the state behind it read the same descriptors,
  // and a pinned control's options are what its chips are labelled from.
  const controls = filterControls?.(rows) ?? [];

  let filterState = null;

  let cardView = null;
  let tableView = null;

  // The picks, and the bindings that keep the table and the cards showing what is held. The
  // controller is the panel's own where there is one — a comparison holds its picks itself —
  // and this view's where the list hands them on.
  let picks = null;

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

  // ─── PICKS ─────────────────────────────────────────────────────────────────

  function createBindings(controller) {
    return {
      controller,

      // `enabled` is read live, which is what lets picking be turned on and off without
      // rebuilding the rows.
      //
      // `claimLinks` only where the reader turned picking on: there a row is a control and
      // the links inside it go nowhere. A list that is always picking keeps them, since the
      // model and submission a score belongs to have no other way out of that list.
      table: createTableBinding(controller, {
        enabled: () => comparing,
        claimLinks: () => comparing && !alwaysPicking,
      }),
      cards: createCards ? createCardBinding(controller) : null,
    };
  }

  function heldCount() {
    return picks?.controller.size ?? 0;
  }

  // Whether the views are picking, written onto them rather than rebuilt into them: a table's
  // `selectableRows` is fixed when its rows are built, so the binding gates the clicks and
  // this only marks what the reader can do — see `enabled` in tables/table.js.
  function applyPicking() {
    if (tableView) {
      tableView.element.dataset.rowsSelectable = String(comparing);
    }

    if (!cardView) return;

    picks?.cards?.attach(comparing ? cardView.element : null);

    cardView.setSelection(
      comparing ? (picks?.cards?.selectionOptions() ?? null) : null,
    );
  }

  // ─── CARDS ─────────────────────────────────────────────────────────────────

  function ensureCardView() {
    if (cardView) return cardView;

    cardView = createCards();

    cardView.setRows(rows);

    if (filterState) {
      cardView.setFilter(filterState.matches);
    }

    applyPicking();

    return cardView;
  }

  function showCards() {
    getSlot("[data-role='list']").replaceChildren(ensureCardView().element);
  }

  // ─── TABLE ─────────────────────────────────────────────────────────────────

  function ensureTableView() {
    if (tableView) return tableView;

    tableView = createTable({
      rows,
      selection: picks?.table?.selectionOptions() ?? null,
    });

    picks?.table?.attach(tableView.table);

    tableView.table?.on("tableBuilt", applyTableFilter);

    applyPicking();

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
    picks?.table?.attach(null);

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

    // Quietly, so the selection events a re-filter fires are not read as the reader's.
    if (picks?.table) {
      picks.table.quietly(apply);
    } else {
      apply();
    }
  }

  // ─── COMPARING ─────────────────────────────────────────────────────────────

  function getCompareButton() {
    return getSlot(`#${COMPARE_BUTTON_ID}`);
  }

  function getGoButton() {
    return getSlot(`#${GO_BUTTON_ID}`);
  }

  // What the buttons beside it are for: how to start comparing, and once the reader has, how
  // many are in and where they are read.
  function getHint() {
    const max = picks?.controller.max ?? 0;

    if (alwaysPicking) {
      return heldCount()
        ? `Selected ${heldCount()} out of ${max}. The comparison is below.`
        : `Select up to ${max} ${pluralise(noun)} to compare them.`;
    }

    if (!comparing) {
      return `Click ${compareLabel} and select up to ${max} ${pluralise(noun)} to compare them.`;
    }

    const selected = `Selected ${heldCount()} out of ${max}.`;

    if (showingPanel) {
      return `${selected} The comparison is below. Click ${DONE_LABEL} to return to the list.`;
    }

    return `${selected} Click ${GO_COMPARE_LABEL} to see the comparison, or ${DONE_LABEL} to return to the list.`;
  }

  // The buttons, the hint and the rows all say the same thing.
  function updateCompare() {
    // A list with nothing to compare has none of them — no hint to write, and no picking to
    // mark. `setText` resolves its element rather than tolerating a missing one, so this is
    // an early return rather than a guard per write.
    if (!comparable) return;

    // Nothing to press, so the picks alone decide whether the comparison is on screen.
    if (alwaysPicking) {
      showingPanel = heldCount() > 0;

      showPanel();
    }

    const compare = getCompareButton();
    const go = getGoButton();

    if (compare) {
      setButtonLabel(compare, {
        label: comparing ? DONE_LABEL : compareLabel,
        icon: getIcon(comparing ? "cancel" : "compare"),
      });

      go.hidden = !comparing;

      // A pick is the fewest that is a comparison — but folding the panel away is always
      // live.
      go.disabled = !showingPanel && heldCount() < 1;

      setButtonLabel(go, {
        label: showingPanel ? HIDE_LABEL : GO_COMPARE_LABEL,
        icon: getIcon(showingPanel ? "collapse" : "compare"),
      });

      // One of them is lit, and it is always the way on: Compare until the reader is
      // comparing, then Go from the first pick. Done is the way back out, so it stays plain.
      compare.classList.toggle("primary-inv", !comparing);
      go.classList.toggle("primary", heldCount() > 0);
    }

    setText(getSlot(`#${HINT_ID}`), getHint());

    applyPicking();
    refreshIcons();
  }

  function showPanel() {
    const section = getSlot(`#section-${PANEL_ID}`);

    if (section) section.hidden = !showingPanel;
  }

  // The picks are given up on the way out, as the leaderboard's are: pressing Compare again
  // starts on a clean list.
  function handleCompare() {
    comparing = !comparing;

    if (!comparing) {
      showingPanel = false;

      picks?.controller.clear();
      showPanel();
    }

    updateCompare();
  }

  // Where the picks are read: a page of its own for a list that hands them on, or the panel
  // under the list, which this is the only way to open and to fold away again.
  function handleGo() {
    if (picking) {
      picking.onCompare(picks.controller.keys());

      return;
    }

    showingPanel = !showingPanel;

    showPanel();
    updateCompare();
  }

  function attachEvents() {
    getSlot(`#${CARD_TOGGLE_ID}`)?.addEventListener("click", () =>
      renderView(CARD_TOGGLE_ID),
    );

    getSlot(`#${TABLE_TOGGLE_ID}`)?.addEventListener("click", () =>
      renderView(TABLE_TOGGLE_ID),
    );

    getCompareButton()?.addEventListener("click", handleCompare);
    getGoButton()?.addEventListener("click", handleGo);
  }

  // ─── MARKUP ────────────────────────────────────────────────────────────────

  // What the picks are for, and — where there is anything to press — the two buttons that
  // work them, at the far end of the toolbar.
  function buildCompareControls() {
    if (!comparable) return "";

    const buttons = alwaysPicking
      ? ""
      : `
        ${buildButton({
          id: GO_BUTTON_ID,
          label: GO_COMPARE_LABEL,
          icon: getIcon("compare"),
          hidden: true,
          disabled: true,
        })}
        ${buildCompareButton({ label: compareLabel, className: "primary-inv" })}
      `;

    return `
      <div class="row right gap-lg">
        <span class="metadata bold action-hint" id="${HINT_ID}"></span>
        ${buttons}
      </div>
    `;
  }

  function buildToolbar() {
    const toggle = createCards ? buildCardTableToggle() : "";
    const compare = buildCompareControls();

    if (!toggle && !compare) return "";

    // `right` where there is no toggle, since a row of one otherwise puts its only child at
    // the near end.
    return `<div class="row${toggle ? "" : " right"} gap-lg">${toggle}${compare}</div>`;
  }

  // Hidden until Go: the comparison is what the reader asked for, not what the list opens on.
  function buildPanel() {
    if (!panel) return "";

    return buildSection({
      id: PANEL_ID,
      title: panel.title ?? "",
      hidden: true,
    });
  }

  function buildFilters() {
    if (!controls.length) return "";

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
      ${buildPanel()}
    `;
  }

  // ─── LIFECYCLE ─────────────────────────────────────────────────────────────

  renderHtml(element, buildViewBody());

  // Before anything below it runs: a panel finds its own controls with getElementById, which
  // answers nothing until this element is in the document. See the note on `container` above.
  resolveContainer(container).replaceChildren(element);

  if (controls.length) {
    filterState = createFilterState({
      controls,
      root: getSlot("#filters"),
      onChange: applyFilters,
    });
  }

  // The panel is built with the list rather than on the first press: it holds the picks, and
  // the hint says how many it has room for before the reader has made one. Its section is
  // hidden, which a widget looking up its own controls does not mind.
  if (comparable) {
    picks = createBindings(
      panel
        ? panel.create(getSlot(`#section-${PANEL_ID}-body`))
        : createPicks({
            max: picking.max,
            palette: picking.palette,
            toPick: picking.toPick,
          }),
    );

    picks.controller.subscribe(updateCompare);
  }

  attachEvents();
  renderView(currentView);
  updateCompare();

  function destroy() {
    destroyTable();
    cardView?.destroy();

    dispose(picks?.controller);
  }

  return { element, destroy };
}

export { createListView };
