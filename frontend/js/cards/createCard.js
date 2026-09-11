// The "new model / new submission / new team" affordance on the list pages, and what an
// empty section offers in place of its cards.
//
// The label carries a Lucide placeholder, so whoever writes the markup refreshes icons.

import { escapeHtml } from "../core/html.js";
import { getIcon } from "../components/icons.js";

function buildCreateCard({ href, label }) {
  return `
    <a class="create-card" href="${escapeHtml(href)}">
      <i class="btn-icon" data-lucide="${getIcon("add")}"></i>
      <span>${escapeHtml(label)}</span>
    </a>
  `;
}

export { buildCreateCard };
