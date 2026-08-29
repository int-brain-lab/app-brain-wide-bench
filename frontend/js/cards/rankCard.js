// The model page's ranking section: where this model places, and where it would place if
// its private work were published.
//
// One row per figure, and each row is the same sentence twice — the public standing, then
// the standing the reader's own private work would earn. Written as `rank/field` rather
// than "3rd of 12" so the two sit side by side and the second is read against the first.
//
// The mover on the right is the point of the section: it is what publishing would change,
// and it is the only thing on the row that isn't just a number.

import { escapeHtml } from "../core/html.js";
import { getIcon } from "../components/icons.js";
import { toRankRows } from "../core/rankData.js";

// Overall takes the neutral grey: it is not a suite, and grey is already what the badges
// use for "not one of the coloured three" — see buildSuiteCoverageBadges.
function variantOf(figure) {
  return figure === "overall" ? "neutral" : figure;
}

// An em dash for a side that hasn't placed, so the chip still says which side it is: the
// pair reads "public — / private 1/3", which is exactly the case publishing would fix.
function positionOf({ rank, nRanked }) {
  return rank == null ? "—" : `${rank}/${nRanked}`;
}

/**
 * What publishing would do to this row, in places.
 *
 * Only where both sides have placed: from nothing to somewhere isn't a number of places,
 * and the chips already say so. A smaller rank is a better one, so a private side that
 * reads lower is a climb.
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
 * @param row        one entry from toRankRows.
 * @param showPrivate whether the reader was given the private side at all.
 * @param submitHref where a submit button goes, or nothing for a reader who isn't on the
 *                   model's team and so has nothing to submit.
 *
 * A suite with no result on either side has no positions to report, so it says so and
 * offers the way out of that state instead. The overall row never does: it is unplaced
 * because the model hasn't entered every suite, and a button there couldn't say which.
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
 * @param ranking    the GET /api/models/{id}/ranking payload, or nothing if it failed to
 *                   load — the section still draws, with every figure unplaced.
 * @param submitHref as buildRankRow.
 *
 * The private chip appears only where the API gave one: it withholds that side from a
 * reader who isn't on the model's team, and an empty chip would read as "nothing pending"
 * rather than "not yours to see".
 */
function buildRankCard(ranking, { submitHref = null } = {}) {
  const showPrivate = Boolean(ranking?.private);

  const rows = toRankRows(ranking)
    .map((row) => buildRankRow(row, showPrivate, submitHref))
    .join("");

  return `<div class="card rank-list column">${rows}</div>`;
}

export { buildRankCard };
