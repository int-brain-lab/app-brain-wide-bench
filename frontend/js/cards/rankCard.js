// Where a model places, and where it would place if its private work were published.
//
// Built as a stat card, because that is what it is: an icon, one figure, and a caps label
// saying what the figure is. The overall position is that figure — the thing a reader opens
// the page for — and the suites behind it are a list under a rule, small enough that four
// rows still read as one card.
//
// Where there is private work to report the figure is a pair, public then private, each
// labelled as a stat card labels its own. The suites carry the private standing in brackets
// after the public one.
//
// Tight down the card: the icon, the figure and its label are one thing, and the rule above
// the suites is what separates them from the list.

import { escapeHtml } from "../core/html.js";
import { toRankRows } from "../utils/modelUtils.js";
import { buildCount } from "../components/count.js";
import { buildIcon } from "../components/icons.js";

// ─── FIGURES ─────────────────────────────────────────────────────────────────

// Overall is not a suite, so it takes the badges' neutral grey — as does a suite the model
// has never entered.
function variantOf(figure, placed) {
  return !placed || figure === "overall" ? "neutral" : figure;
}

function isPlaced({ publicSide, privateSide }) {
  return (publicSide.rank ?? privateSide.rank) != null;
}

// An em dash for a side that hasn't placed.
function positionOf({ rank }) {
  return rank == null ? "—" : escapeHtml(String(rank));
}

// One big number under the icon, with what it is beneath — the stat card's own shape. The
// label is cased by its caller: the figure a card leads with is named in caps, the two sides
// of one are told apart rather than announced. Muted marks the private one.
function buildFigure(side, label, muted = false) {
  return `
    <span class="column centre">
      <span class="statistic${muted ? " muted" : ""}">${positionOf(side)}</span>
      <span class="metadata">${escapeHtml(label)}</span>
    </span>
  `;
}

/**
 * The overall standing, and under it what it is out of.
 *
 * @param row         the overall row from toRankRows.
 * @param showPrivate whether there is private work to report.
 *
 * @returns the markup.
 */
function buildOverall(row, showPrivate) {
  const figures = showPrivate
    ? buildFigure(row.publicSide, "Public") +
      buildFigure(row.privateSide, "Private", true)
    : buildFigure(row.publicSide, "OVERALL");

  // A model placed overall says the field it beat, in the caps a figure's label takes; one
  // that isn't says what it is short of, which reads as a sentence rather than a label.
  const caption = isPlaced(row)
    ? `${showPrivate ? "Overall · " : ""}of ${buildCount(row.publicSide.nRanked || row.privateSide.nRanked, "model")}`.toUpperCase()
    : `${row.coverage.scored} of ${buildCount(row.coverage.total, "suite")} scored`;

  return `
    <div class="row centre gap-xl">${figures}</div>
    <span class="metadata">${escapeHtml(caption)}</span>
  `;
}

// ─── SUITES ──────────────────────────────────────────────────────────────────

// The badge, and the standing beside it: the position, the private one in brackets after it,
// and the field both are out of. Small, so three of them sit under the figure rather than
// competing with it.
function buildSuiteRow(row, showPrivate) {
  const placed = isPlaced(row);

  if (!placed) {
    return `
      <span><span class="badge md neutral">${escapeHtml(row.label)}</span></span>
      <span class="rank-value muted">—</span>
    `;
  }

  const held = showPrivate
    ? ` <span class="muted">(${positionOf(row.privateSide)})</span>`
    : "";

  const field = row.publicSide.nRanked || row.privateSide.nRanked;

  return `
    <span>
      <span class="badge md ${escapeHtml(variantOf(row.figure, placed))}">
        ${escapeHtml(row.label)}
      </span>
    </span>
    <span class="rank-value">
      ${positionOf(row.publicSide)}${held}
      <span class="metadata">OF ${escapeHtml(String(field))}</span>
    </span>
  `;
}

// ─── CARD ────────────────────────────────────────────────────────────────────

/**
 * The ranking card.
 *
 * @param ranking     the GET /api/models/{id}/ranking payload. Omit if it failed to load —
 *                    the card then draws every figure unplaced.
 * @param showPrivate whether the model is holding scores the leaderboard hasn't seen — see
 *                    hasPrivateOnlyScores. Off leaves the public standing on its own.
 *
 * @returns the markup.
 */
function buildRankCard(ranking, { showPrivate = false } = {}) {
  // Every figure, placed or not — see toRankRows, which is what makes a model with no
  // ranking at all a card of dashes rather than an empty one. Overall always leads it.
  const [overall, ...suites] = toRankRows(ranking);

  return `
    <div class="stat-card gap-sm">
      ${buildIcon("leaderboard", { className: "stat-icon" })}

      ${buildOverall(overall, showPrivate)}

      <div class="rank-grid">
        ${suites.map((row) => buildSuiteRow(row, showPrivate)).join("")}
      </div>
    </div>
  `;
}

export { buildRankCard };
