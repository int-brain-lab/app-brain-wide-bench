// Card view for a list: a paginated grid with the table view's footer and count.
//
// The page is this module's; the filter and the selection are set from outside.
//
// createCardGrid is built once and kept; the caller attaches its element.

import { clearContent, refreshIcons, renderHtml } from "../core/render.js";
import { buildTableCount } from "../components/count.js";
import { buildEmptyMessage } from "../components/messages.js";

const MAX_PAGE_BUTTONS = 5;

const CARDS_PER_PAGE = 8;

// ─── PAGINATION ──────────────────────────────────────────────────────────────

function getPageNumbers(currentPage, pageCount) {
  const count = Math.min(MAX_PAGE_BUTTONS, pageCount);

  const first = Math.min(
    Math.max(1, currentPage - Math.floor(count / 2)),
    pageCount - count + 1,
  );

  return Array.from({ length: count }, (_, index) => first + index);
}

function buildPageButton(
  label,
  page,
  { active = false, disabled = false } = {},
) {
  return `
    <button
      type="button"
      class="pager-page${active ? " active" : ""}"
      data-page="${page}"
      ${active ? 'aria-current="page"' : ""}
      ${disabled ? "disabled" : ""}
    >
      ${label}
    </button>
  `;
}

function buildPager(currentPage, pageCount) {
  if (pageCount < 2) return "";

  return `
    <div class="row right gap-xs" data-role="pager">
      ${buildPageButton("First", 1, {
        disabled: currentPage === 1,
      })}

      ${buildPageButton("Prev", currentPage - 1, {
        disabled: currentPage === 1,
      })}

      ${getPageNumbers(currentPage, pageCount)
        .map((page) =>
          buildPageButton(page, page, {
            active: page === currentPage,
          }),
        )
        .join("")}

      ${buildPageButton("Next", currentPage + 1, {
        disabled: currentPage === pageCount,
      })}

      ${buildPageButton("Last", pageCount, {
        disabled: currentPage === pageCount,
      })}
    </div>
  `;
}

function clampPage(page, pageCount) {
  return Math.min(Math.max(1, page), Math.max(1, pageCount));
}

// ─── SELECTION ───────────────────────────────────────────────────────────────

// `root` is any ancestor of the cards.
function highlightSelectedCards(root, keys) {
  root.querySelectorAll(".card[data-key]").forEach((card) => {
    card.classList.toggle("selected", keys.has(card.dataset.key));
  });
}

function setSelectable(grid, selectable) {
  grid.dataset.cardsSelectable = String(selectable);

  grid.querySelectorAll(".card[data-key]").forEach((card) => {
    if (selectable) {
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
    } else {
      card.removeAttribute("role");
      card.removeAttribute("tabindex");
    }
  });
}

function toRowMap(rows, getKey) {
  return new Map(rows.map((row) => [String(getKey(row)), row]));
}

// ─── MARKUP ──────────────────────────────────────────────────────────────────

// `total` is the count before filtering.
function buildGridHtml({
  visibleRows,
  buildCards,
  total,
  noun,
  page,
  pageCount,
}) {
  return `
    <div class="grid-2" data-role="cards">
      ${buildCards(visibleRows)}
    </div>

    <div class="table-footer cards-footer">
      <span>
        ${buildTableCount(visibleRows.length, total, noun)}
      </span>

      ${buildPager(page, pageCount)}
    </div>
  `;
}

// ─── GRID ────────────────────────────────────────────────────────────────────

/**
 * A card grid that is built once and kept. The rows, the filter and the page live here.
 *
 * @param buildCards   (rows) => HTML.
 * @param noun         *singular*, for the footer — "model". The count adds the "s".
 * @param cardsPerPage how many cards a page holds.
 * @param getKey       (row) => the key a card is identified by.
 *
 * @returns { element, setRows, setFilter, setSelection, destroy }. `element` is the grid's
 *          own, detached until the caller places it, and never replaced.
 */
function createCardGrid({
  buildCards,
  noun,
  cardsPerPage = CARDS_PER_PAGE,
  getKey = (row) => row.id,
}) {
  const element = document.createElement("div");

  element.className = "column gap-md";

  let allRows = [];
  let activeFilter = null;
  let page = 1;

  // `{ keys, onToggle }`, or null when nothing is pickable.
  let activeSelection = null;

  // Key => row, for the page on screen.
  let rowMap = new Map();

  function visible() {
    return activeFilter ? allRows.filter(activeFilter) : allRows;
  }

  function render() {
    const matching = visible();

    clearContent(element);

    if (!matching.length) {
      renderHtml(
        element,
        buildEmptyMessage(`No ${noun}s match these filters.`),
      );
      rowMap = new Map();

      return;
    }

    const pageCount = Math.ceil(matching.length / cardsPerPage);

    page = clampPage(page, pageCount);

    const start = (page - 1) * cardsPerPage;
    const visibleRows = matching.slice(start, start + cardsPerPage);

    renderHtml(
      element,
      buildGridHtml({
        visibleRows,
        buildCards,
        total: allRows.length,
        noun,
        page,
        pageCount,
      }),
    );

    const grid = element.querySelector("[data-role='cards']");

    rowMap = toRowMap(visibleRows, getKey);

    // Positional: `buildCards` returns one string, mapping its rows in order.
    grid.querySelectorAll(":scope > .card").forEach((card, index) => {
      card.dataset.key = String(getKey(visibleRows[index]));
    });

    setSelectable(grid, Boolean(activeSelection));

    if (activeSelection) highlightSelectedCards(grid, activeSelection.keys);

    refreshIcons();
  }

  function onClick(event) {
    const pageButton = event.target.closest("[data-page]");

    if (pageButton) {
      page = Number(pageButton.dataset.page);
      render();

      return;
    }

    if (!activeSelection) return;

    const card = event.target.closest(".card[data-key]");

    if (!card) return;

    // A card is a link; while it is a selection control the click must not navigate.
    event.preventDefault();

    const row = rowMap.get(card.dataset.key);

    if (row) activeSelection.onToggle(row);
  }

  element.addEventListener("click", onClick);

  /** @param rows every row, unfiltered. Resets to the first page. */
  function setRows(rows) {
    allRows = rows ?? [];
    page = 1;

    render();
  }

  /** @param filter a predicate, or null for no narrowing. Resets to the first page. */
  function setFilter(filter) {
    activeFilter = filter ?? null;
    page = 1;

    render();
  }

  /** @param selection `{ keys, onToggle }` to make the cards pickable, or null to stop. */
  function setSelection(selection) {
    activeSelection = selection ?? null;

    render();
  }

  function destroy() {
    element.removeEventListener("click", onClick);
    clearContent(element);
  }

  return { destroy, element, setFilter, setRows, setSelection };
}

export { createCardGrid, highlightSelectedCards };
