// Several things side by side, one per row, with a fixed set of columns describing them.
//
// The shape a comparison of *attributes* takes, as opposed to a comparison of numbers: what
// is being compared goes down the rows so that adding another is another row rather than
// another column squeezing the rest, and the columns stay put.
//
// Columns where every row agrees are muted, header included. Agreement is the background
// against which the differences are the finding, and with six rows of near-identical
// metadata it is the only thing that makes the differences visible at all.
//
// Plain markup, not Tabulator: a handful of rows that never sort or filter, with the odd
// control living in a cell.
//
// Three scales of one thing, so they live together: the grid, the header of one of its rows,
// and the ✕ in that header. `dropFromClick` is the ✕'s other half — the markup is rebuilt on
// every render, so the listener sits on an ancestor and reads what was clicked.

import { escapeHtml } from "../core/html.js";
import { getIcon } from "./icons.js";

// Colours reach markup as a custom property, and escapeHtml does not sanitise CSS — so what
// goes in is checked here rather than trusted from the caller.
const HEX = /^#[0-9a-f]{3,8}$/i;

const DROP_ROLE = "drop";

// ─── ROW HEADERS ─────────────────────────────────────────────────────────────

function buildDropButton(key, name) {
  return `
    <button
      type="button"
      class="chip-remove"
      data-role="${DROP_ROLE}"
      data-key="${escapeHtml(key)}"
      title="Remove ${escapeHtml(name)}"
      aria-label="Remove ${escapeHtml(name)}"
    >
      <i class="field-icon" data-lucide="${escapeHtml(getIcon("remove"))}"></i>
    </button>`;
}

/**
 * A row header: the ✕, what the row is, and a quieter line under it.
 *
 * @param key   the entry's, which is what the ✕ hands back.
 * @param title markup — a link, a label, a run of badges.
 * @param meta  text, escaped here.
 * @param name  the thing's name in plain words, for the button's label.
 */
function buildRowHeader({ key, title, meta = "", name = "" }) {
  return `
    <span class="column gap-xs">
      <span class="row left gap-sm">
        ${buildDropButton(key, name)}
        ${title}
      </span>
      ${meta ? `<span class="metadata">${escapeHtml(meta)}</span>` : ""}
    </span>`;
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

// A cell is a value to compare and, optionally, the markup to show instead of it — a
// select, a badge. The value is what decides whether the column agrees, so a control still
// counts as its current setting.
function cellHtml(cell) {
  if (cell?.html) return cell.html;

  return cell?.value == null || cell.value === ""
    ? "—"
    : escapeHtml(cell.value);
}

function columnAgrees(key, rows) {
  return new Set(rows.map((row) => row.cells[key]?.value ?? "")).size <= 1;
}

/**
 * @param columns [{ key, label }] — fixed, in order.
 * @param rows    [{ key, header, ink, cells: { [columnKey]: { value, html } } }]. `header` is
 *                markup, because what identifies a row — a badge, a remove button, a second
 *                line — is the caller's business. `ink` is the colour the row is marked in,
 *                for a comparison whose rows are drawn elsewhere too.
 * @param className extra classes on the wrapper, for a caller with its own column widths.
 * @returns the markup.
 */
function buildComparisonGrid({ columns, rows, className = "" }) {
  const state = new Map(
    columns.map((column) => [
      column.key,
      columnAgrees(column.key, rows) ? "agrees" : "differs",
    ]),
  );

  const headers = columns
    .map(
      (column) =>
        `<th scope="col" class="${state.get(column.key)}">${escapeHtml(column.label)}</th>`,
    )
    .join("");

  const body = rows
    .map(
      (row) => `
      <tr${inkStyle(row.ink)}>
        <th scope="row">${row.header}</th>
        ${columns
          .map(
            (column) => `
          <td class="${state.get(column.key)}">${cellHtml(row.cells[column.key])}</td>
        `,
          )
          .join("")}
      </tr>`,
    )
    .join("");

  return `
    <div class="table comparison-grid ${escapeHtml(className)}">
      <table>
        <thead><tr><th></th>${headers}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

export { buildComparisonGrid, buildRowHeader, dropFromClick };
