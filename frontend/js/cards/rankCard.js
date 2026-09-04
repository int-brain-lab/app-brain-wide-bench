// Where a model places, and where it would place if its private work were published.
//
// One row per figure, each carrying both standings as `rank/field` so the second reads
// against the first, and the mover saying what publishing would change.

import { escapeHtml } from "../core/html.js";
import { toRankRows } from "../utils/modelUtils.js";
import { getIcon } from "../components/icons.js";

// Overall is not a suite, so it takes the badges' neutral grey.
function variantOf(figure) {
  return figure === "overall" ? "neutral" : figure;
}

// An em dash for a side that hasn't placed, so the chip still says which side it is.
function positionOf({ rank, nRanked }) {
  return rank == null ? "—" : `${rank}/${nRanked}`;
}

/**
 * What publishing would do to this row, in places. A smaller rank is a better one.
 *
 * @param publicSide  the row's public side, as toRankRows gives it.
 * @param privateSide the same row's private side.
 *
 * @returns the markup, or "" unless both sides have placed.
 */
function buildMover({ publicSide, privateSide }) {
  if (publicSide.rank == null || privateSide.rank == null) return "";

  const places = publicSide.rank - privateSide.rank;

  if (places === 0) return "";

  const direction = places > 0 ? "up" : "down";
  const arrow = places > 0 ? "↑" : "↓";

  return `<span class="rank-mover ${direction}">${arrow} ${Math.abs(places)}</span>`;
}

// ─── ROWS ────────────────────────────────────────────────────────────────────

function buildChips(row, showPrivate) {
  const chips = [
    `<span class="badge rank-chip">Public ${positionOf(row.publicSide)}</span>`,
  ];

  if (showPrivate) {
    chips.push(
      `<span class="badge rank-chip private">Private ${positionOf(row.privateSide)}</span>`,
    );
  }

  return `<span class="row left gap-sm rank-chips">${chips.join("")}</span>`;
}

/**
 * One suite's row: its badge, both standings, and the mover or a way out.
 *
 * @param row         one entry from toRankRows.
 * @param showPrivate whether the reader was given the private side at all.
 * @param submitHref  where a submit button goes. Omit for a reader with nothing to submit.
 *
 * @returns the markup.
 */
function buildRankRow(row, showPrivate, submitHref) {
  const placed = (row.publicSide.rank ?? row.privateSide.rank) != null;
  const empty = !placed && row.coverage === null;

  const middle = empty
    ? `<span class="rank-chips metadata">No submission yet</span>`
    : buildChips(row, showPrivate);

  const end =
    empty && submitHref
      ? `<a class="btn with-icon rank-end" href="${escapeHtml(submitHref)}">
         <i class="btn-icon" data-lucide="${escapeHtml(getIcon("add"))}"></i>
         Submit
       </a>`
      : `<span class="rank-end metadata">${
          row.coverage && !placed
            ? `${row.coverage.scored} of ${row.coverage.total} suites`
            : buildMover(row)
        }</span>`;

  return `
    <div class="row gap-md rank-row">
      <span class="rank-badge">
        <span class="badge ${escapeHtml(variantOf(row.figure))}">${escapeHtml(row.label)}</span>
      </span>
      ${middle}
      ${end}
    </div>`;
}

// ─── CARD ────────────────────────────────────────────────────────────────────

/**
 * The ranking card: one row per suite, plus the overall. The private chip appears only
 * where the API gave one — it withholds that side from a reader off the model's team.
 *
 * @param ranking    the GET /api/models/{id}/ranking payload. Omit if it failed to load —
 *                   the card still draws, every figure unplaced.
 * @param submitHref as buildRankRow.
 *
 * @returns the markup.
 */
function buildRankCard(ranking, { submitHref = null } = {}) {
  const showPrivate = Boolean(ranking?.private);

  const rows = toRankRows(ranking)
    .map((row) => buildRankRow(row, showPrivate, submitHref))
    .join("");

  return `<div class="card rank-list column">${rows}</div>`;
}

export { buildRankCard };
