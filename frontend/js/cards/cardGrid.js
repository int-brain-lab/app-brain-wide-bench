// The card view of a list: a page of cards in a grid, with the footer the table has.
//
// The counterpart to createFilterableTable, and deliberately its shape — same count in the
// same words, page buttons in the same place — because the two are one list read two ways
// and a reader switching between them shouldn't have to re-learn where anything is.
//
// Filtering isn't here: the page above owns the filter bar and hands down whichever rows
// survived it. This only slices, draws and reports.

import { buildTableCount } from "../components/count.js";
import { showEmpty } from "../core/utils.js";

// Enough to see where you are without the footer becoming a second list. Beyond this the
// window slides, so the current page is always in it.
const MAX_PAGE_BUTTONS = 5;

// ─── PAGER ──────────────────────────────────────────────────────────────────

// The window of page numbers around the current page, clamped to both ends so a page near
// either edge still gets MAX_PAGE_BUTTONS of them rather than a short row.
function pageWindow(page, pageCount) {
  const span = Math.min(MAX_PAGE_BUTTONS, pageCount);
  const first = Math.min(
    Math.max(1, page - Math.floor(span / 2)),
    pageCount - span + 1,
  );

  return Array.from({ length: span }, (_, offset) => first + offset);
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
      ${active ? `aria-current="page"` : ""}
      ${disabled ? "disabled" : ""}
    >${label}</button>
  `;
}

// No buttons for a single page, which is also what Tabulator does — a lone "1" is a control
// that can only ever do nothing.
function buildPager(page, pageCount) {
  if (pageCount < 2) return "";

  return `
    <div class="row right gap-xs" data-role="pager">
      ${buildPageButton("‹", page - 1, { disabled: page === 1 })}
      ${pageWindow(page, pageCount)
        .map((number) =>
          buildPageButton(number, number, { active: number === page }),
        )
        .join("")}
      ${buildPageButton("›", page + 1, { disabled: page === pageCount })}
    </div>
  `;
}

// ─── GRID ───────────────────────────────────────────────────────────────────

// The cards come back as one HTML string, so the keys go on afterwards by position: a
// builder maps its rows one to one, in order, which is what makes that sound. Positional
// rather than built into the markup because what a card's key *is* belongs to the page that
// compares them — see `toSeed` in templates/list-page.js — not to the card.
function assignKeys(grid, rows, keyOf) {
  grid.querySelectorAll(":scope > .card").forEach((card, index) => {
    card.dataset.key = keyOf(rows[index]);

    // An <a> that picks instead of navigating is a button for as long as the mode lasts,
    // and the highlight alone would say so only to a reader who can see it.
    card.setAttribute("role", "button");
  });
}

/**
 * Repaint which cards are picked, without redrawing them.
 *
 * Exported because the set can change from outside this grid — a pick made in the table
 * before the reader switched to cards, or one dropped from the comparison itself.
 *
 * @param container what renderCardGrid drew into.
 * @param keys      the picked keys.
 */
function markCardSelection(container, keys) {
  for (const card of container.querySelectorAll(".card[data-key]")) {
    const picked = keys.has(card.dataset.key);

    card.classList.toggle("selected", picked);
    card.setAttribute("aria-pressed", String(picked));
  }
}

/**
 * Draws one page of cards into `container`, replacing whatever is there.
 *
 * @param container element the grid and its footer are written into.
 * @param rows      the rows that survived the filter, already mapped by the domain's
 *                  `toXRows` — the cards render from the same shape the filters match.
 * @param cards     (rows) => HTML, the domain's card builder.
 * @param total     rows before the filter, so the footer can say "8 out of 25".
 * @param noun      *singular* — the footer adds the "s", as the tables do.
 * @param page      1-based. Clamped here, so a caller that filtered the list out from under
 *                  the reader doesn't have to.
 * @param pageSize  cards per page.
 * @param onPage    (page) => void, when a page button is clicked.
 * @param selection optional {keys, max, onToggle} — makes the cards pickable. `keys` is the
 *                  set of picked keys, held by the caller because it outlives this render:
 *                  it survives paging, filtering and the switch to the table. `onToggle(key)`
 *                  is called with what was clicked; nothing is picked or unpicked here.
 * @param keyOf     (row) => key, matching whatever `selection.keys` holds.
 * @returns the page actually drawn, which is `page` clamped to what the rows allow.
 */
function renderCardGrid({
  container,
  rows,
  cards,
  total,
  noun,
  page = 1,
  pageSize = 8,
  onPage,
  selection = null,
  keyOf = (row) => row.id,
}) {
  container.className = "column gap-md";
  container.replaceChildren();

  // The same words Tabulator's placeholder uses, for the same state: the list has rows and
  // the filters are hiding all of them.
  if (!rows.length) {
    showEmpty(container, `No ${noun}s match these filters.`);
    return 1;
  }

  const pageCount = Math.ceil(rows.length / pageSize);
  const current = Math.min(Math.max(1, page), pageCount);
  const shown = rows.slice((current - 1) * pageSize, current * pageSize);

  container.innerHTML = `
    <div class="grid-2" data-role="cards">${cards(shown)}</div>
    <div class="table-footer">
      <span>${buildTableCount(shown.length, total, noun)}</span>
      ${buildPager(current, pageCount)}
    </div>
  `;

  const grid = container.querySelector("[data-role='cards']");

  // What the cursor keys off, as `data-rows-selectable` does for the table. On the container
  // rather than the grid so the whole view is scoped by it.
  container.dataset.cardsSelectable = selection ? "true" : "false";

  if (selection) {
    assignKeys(grid, shown, keyOf);
    markCardSelection(container, selection.keys);
  }

  // Both listeners go on elements this render just created, not on `container` — which is
  // the same element every time and would collect a handler per render, each closed over the
  // rows and the page it was drawn with.
  container
    .querySelector("[data-role='pager']")
    ?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-page]");

      if (button) onPage?.(Number(button.dataset.page));
    });

  if (selection) {
    grid.addEventListener("click", (event) => {
      const card = event.target.closest(".card[data-key]");
      if (!card) return;

      // The card is a link to the thing it is about, and while it is a control that link is
      // what a click would otherwise follow — losing the half-built comparison with it. Same
      // trade the table makes with `claimLinks`.
      event.preventDefault();

      const { key } = card.dataset;

      // Refused rather than swapped: silently dropping someone's first pick to make room for
      // their sixth is worse than doing nothing.
      if (!selection.keys.has(key) && selection.keys.size >= selection.max)
        return;

      selection.onToggle(key);
    });
  }

  globalThis.lucide?.createIcons?.();

  return current;
}

export { markCardSelection, renderCardGrid };
