// The bar a score is drawn as.
//
// Every primary metric is read on 0 to 1, so one bar is comparable with the next. Whatever
// draws it owns the number, the task and the rank; this owns the mark.

import { escapeHtml } from "../core/html.js";

// r2 and poisson_d2 are unbounded below, so a real score can be negative — and
// `width: -14%` is not a short bar, it is no bar at all, silently identical to "no score".
// Clamped rather than hidden: the number beside it still reports what was measured.
function barWidth(value) {
  return value == null
    ? 0
    : Math.min(100, Math.max(0, Math.round(value * 100)));
}

/**
 * One score as a bar.
 *
 * @param value the score, 0 to 1. Null draws an empty track.
 * @param suite whose colour the fill takes. Omit for a bar with no suite behind it.
 *
 * @returns the markup.
 */
function buildScoreBar(value, suite = "") {
  return `
    <div class="bar-track wide-bar">
      <div
        class="bar wide-bar ${escapeHtml(suite)}"
        style="width:${barWidth(value)}%"
      ></div>
    </div>`;
}

export { buildScoreBar };
