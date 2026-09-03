// Several things side by side, compared on a fixed set of attributes.
//
// The shape a comparison of *attributes* takes, as opposed to a comparison of numbers. Which
// axis the things go on is the caller's: down the rows, so that adding another is another row
// and the attribute columns stay put; or across the columns, for a set of attributes long
// enough that reading them as a column is easier than reading them as a header.
//
// Either way an attribute every thing answers the same way is muted, label included.
// Agreement is the background against which the differences are the finding, and with six
// near-identical sets of metadata it is the only thing that makes the differences visible.
//
// Plain markup, not Tabulator: a handful of cells that never sort or filter, with the odd
// control living in one of them.
//
// Two scales of one thing, so they live together: the grid, and the row of chips naming what
// is being compared.
//
// The chips are the whole of the naming, and the grid says nothing about what its columns are:
// a comparison is several readings of one set of picks — a grid, a plot, a table — and naming
// them once above all of them beats naming them in each. So a column carries only the colour
// of the chip it belongs to, which is also the colour it is drawn in everywhere else.
//
// The chips are also where an entity is taken out again. `dropFromClick` is the ✕'s other half,
// since the chips are rebuilt on every render and the listener sits on the row that holds
// them.

import { escapeHtml } from "../core/html.js";
import { getIcon } from "./icons.js";

// Colours reach markup as a custom property, and escapeHtml does not sanitise CSS — so what
// goes in is checked here rather than trusted from the caller.
const HEX = /^#[0-9a-f]{3,8}$/i;

const DROP_ROLE = "drop";

// ─── PICKS ───────────────────────────────────────────────────────────────────

function pickStyle(ink) {
  return HEX.test(ink ?? "") ? ` style="--pick-ink:${ink}"` : "";
}

/**
 * What is being compared, as a chip each with an ✕ to take it out again.
 *
 * @param picks [{ key, label, ink }] — `key` is what the ✕ hands back, `ink` the colour the
 *              thing is drawn in everywhere else, which tints its chip.
 * @returns the markup, or nothing at all for an empty comparison: the row is the caller's and
 *          an empty one should collapse rather than hold a blank chip.
 */
function buildPicks(picks) {
  return picks
    .map(
      ({ key, label, ink }) => `
    <span class="chip pick"${pickStyle(ink)}>
      ${escapeHtml(label)}
      <button
        type="button"
        class="chip-remove"
        data-role="${DROP_ROLE}"
        data-key="${escapeHtml(key)}"
        title="Remove ${escapeHtml(label)}"
        aria-label="Remove ${escapeHtml(label)}"
      >
        <i class="field-icon" data-lucide="${escapeHtml(getIcon("remove"))}"></i>
      </button>
    </span>`,
    )
    .join("");
}

/**
 * The key a click asked to drop, or null if it landed anywhere else.
 */
function dropFromClick(event) {
  return (
    event.target.closest(`[data-role='${DROP_ROLE}']`)?.dataset.key ?? null
  );
}

// ─── GRID ────────────────────────────────────────────────────────────────────

function inkStyle(ink) {
  return HEX.test(ink ?? "") ? ` style="--row-ink:${ink}"` : "";
}

// The ink rides on the cell in the turned layout: a column cannot inherit a custom property
// from the header above it, where a row's cells inherit it from the row.
const CELL = (state, html, ink = "") =>
  `<td class="${state}"${ink}>${html}</td>`;

// A cell is a value to compare and, optionally, the markup to show instead of it — a
// select, a badge. The value is what decides whether the column agrees, so a control still
// counts as its current setting.
function cellHtml(cell) {
  if (cell?.html) return cell.html;

  return cell?.value == null || cell.value === ""
    ? "—"
    : escapeHtml(cell.value);
}

// Whether every thing being compared answers this attribute the same way — which is what
// decides whether it recedes. Read off `value` and not the markup, so a cell holding a
// control still counts as its current setting.
function attributeAgrees(key, entities) {
  return new Set(entities.map((entity) => entity.cells[key]?.value ?? "")).size <= 1;
}

/**
 * @param entities   [{ ink, cells: { [attributeKey]: { value, html } } }] — the things being
 *                   compared, in order. `ink` is the colour one is drawn in everywhere else,
 *                   which is the only thing here that says which is which: what they are
 *                   called is the row of chips above the grid — see buildPicks.
 * @param attributes [{ key, label }] — what they are compared on, fixed and in order.
 * @param layout     "rows" puts an entity per row and an attribute per column — for a few
 *                   attributes read across. "columns" turns it: an entity per column and an
 *                   attribute per row, for a long set of attributes, where a header of nine
 *                   of them is unreadable and a column of nine is a list.
 * @param className  extra classes on the wrapper, for a caller with its own widths.
 * @returns the markup.
 */
function buildComparisonGrid({
  entities,
  attributes,
  layout = "rows",
  className = "",
}) {
  const state = new Map(
    attributes.map((attribute) => [
      attribute.key,
      attributeAgrees(attribute.key, entities) ? "agrees" : "differs",
    ]),
  );

  const label = (attribute, scope) =>
    `<th scope="${scope}" class="${state.get(attribute.key)}">${escapeHtml(attribute.label)}</th>`;

  // The ink goes on whichever element heads the entity, since that is what it identifies —
  // the row in one layout, the column header in the other.
  const head =
    layout === "columns"
      ? entities
          .map((entity) => `<th scope="col"${inkStyle(entity.ink)}></th>`)
          .join("")
      : attributes.map((attribute) => label(attribute, "col")).join("");

  const body =
    layout === "columns"
      ? attributes
          .map(
            (attribute) => `
      <tr>
        ${label(attribute, "row")}
        ${entities
          .map((entity) =>
            CELL(
              state.get(attribute.key),
              cellHtml(entity.cells[attribute.key]),
              inkStyle(entity.ink),
            ),
          )
          .join("")}
      </tr>`,
          )
          .join("")
      : entities
          .map(
            (entity) => `
      <tr${inkStyle(entity.ink)}>
        <th scope="row"></th>
        ${attributes
          .map((attribute) =>
            CELL(
              state.get(attribute.key),
              cellHtml(entity.cells[attribute.key]),
            ),
          )
          .join("")}
      </tr>`,
          )
          .join("");

  const classes = ["table", "comparison-grid", layout === "columns" ? "by-column" : "", className]
    .filter(Boolean)
    .join(" ");

  return `
    <div class="${escapeHtml(classes)}">
      <table>
        <thead><tr><th></th>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

export { buildComparisonGrid, buildPicks, dropFromClick };
