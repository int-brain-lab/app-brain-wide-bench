// The figure-and-label tiles across the top of every dashboard.
//
// `[label, value, icon]` triples: every caller writes the row as a literal list, and the
// order is the layout.

import { escapeHtml } from "../core/html.js";

function buildStatCard([label, value, icon]) {
  return `
    <div class="stat-card gap-sm">
      <div class="row gap-md">
        <i class="stat-icon" data-lucide="${escapeHtml(icon)}"></i>
        <p class="statistic">${escapeHtml(value)}</p>
      </div>
      <p class="metadata">${escapeHtml(label).toUpperCase()}</p>
    </div>`;
}

function buildStatCards(statistics) {
  return statistics.map(buildStatCard).join("");
}

export { buildStatCards };
