// The "new model / new submission / new team" affordance on the list pages.
//
// Two shapes for one control:
//
//   as a row    a full-width strip under the list, which is what both views of a list page
//               use — it can't be a real table row, since Tabulator owns the list container
//               and its rows come from the data, so it's a sibling styled to meet the
//               table's bottom edge. Once the cards page, a cell in the grid would either
//               repeat on every page or hide on all but one.
//   as a cell   appended to a grid of cards, so it sits beside the records at their width
//               and stretches to their row height. For a fixed grid that doesn't page —
//               the sections on the model and team pages.
//
// Both call createIcons: the label carries a Lucide `plus` placeholder, and createIcons
// consumes placeholders, so it has to run after this markup lands rather than once at page
// load — the nav modules' own call may well have already happened by then.

import { escapeHtml } from "../core/utils.js";
import { getIcon } from "../components/icons.js";

function buildMarkup({ href, label }, extraClass = "") {
  return `
    <a class="create-card ${extraClass}" href="${escapeHtml(href)}">
      <i class="btn-icon" data-lucide="${getIcon("add")}"></i>
      <span>${escapeHtml(label)}</span>
    </a>
  `;
}

function refreshIcons() {
  globalThis.lucide?.createIcons?.();
}

/**
 * Append the card into the grid that already holds the record cards, so it becomes the
 * last cell. Call after the grid's own innerHTML has been written.
 *
 * No `options` means no affordance — a list read by a signed-out visitor has nothing to
 * create with, and every caller would otherwise need the same guard.
 */
function appendCreateCard(container, options) {
  if (!options) return;

  container.insertAdjacentHTML("beforeend", buildMarkup(options));
  refreshIcons();
}

/** Write the full-width variant into its own container, below the table. */
function renderCreateRow(container, options) {
  if (!options) {
    clearCreateRow(container);
    return;
  }

  container.innerHTML = buildMarkup(options, "as-row");
  refreshIcons();
}

/** Empty the dedicated container — used when switching back to card view. */
function clearCreateRow(container) {
  container.replaceChildren();
}

export { appendCreateCard, renderCreateRow, clearCreateRow };
