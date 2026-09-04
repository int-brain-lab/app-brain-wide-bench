// The "new model / new submission / new team" affordance on the list pages.
//
// Two shapes: a strip under a table, and a cell appended to a grid of cards. The label
// carries a Lucide placeholder, so both need refreshIcons after the markup lands.

import { escapeHtml } from "../core/html.js";
import { refreshIcons } from "../core/render.js";
import { getIcon } from "../components/icons.js";

function buildCreateCard({ href, label }) {
  return `
    <a class="create-card" href="${escapeHtml(href)}">
      <i class="btn-icon" data-lucide="${getIcon("add")}"></i>
      <span>${escapeHtml(label)}</span>
    </a>
  `;
}

/**
 * The card as the last cell of a grid that already holds the record cards.
 *
 * @param container the grid, its own innerHTML already written.
 * @param options   as buildCreateCard. Omit for no affordance — a signed-out reader has
 *                  nothing to create with.
 */
function appendCreateCard(container, options) {
  if (!options) return;

  container.insertAdjacentHTML("beforeend", buildCreateCard(options));
  refreshIcons();
}

export { appendCreateCard, buildCreateCard };
