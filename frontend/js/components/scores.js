// A score written out: the number and the spread it was measured to.
//
// The bar the same score is drawn as is components/bars.js.

import { escapeHtml } from "../core/html.js";
import { score } from "../core/utils.js";

// ─── EMPTY ───────────────────────────────────────────────────────────────────

const EMPTY_VALUE = "—";

function emptyMetadata() {
  return `<span class="metadata">${EMPTY_VALUE}</span>`;
}

// ─── SCORES ──────────────────────────────────────────────────────────────────

/**
 * A mean and the spread it was measured to.
 *
 * @param mean    the score. Null reads as unscored.
 * @param sem     the standard error. Null on a single-seed run, which has no spread.
 * @param stacked the spread on its own line under the value. Omit for one line.
 *
 * @returns the markup.
 */
function buildMeanSem(mean, sem, { stacked = false } = {}) {
  if (mean == null) return emptyMetadata();

  const value = `<span class="value">${escapeHtml(score(mean))}</span>`;

  if (sem == null) return value;

  const spread = `<span class="metadata">± ${escapeHtml(score(sem))}</span>`;

  return stacked ? `<span class="column gap-xs">${value}${spread}</span>` : `${value} ${spread}`;
}

export { buildMeanSem, emptyMetadata, EMPTY_VALUE };
