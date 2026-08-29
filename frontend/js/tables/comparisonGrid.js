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

import { escapeHtml } from "../core/html.js";

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
 * @param rows    [{ key, header, cells: { [columnKey]: { value, html } } }]. `header` is
 *                markup, because what identifies a row — a badge, a remove button, a second
 *                line — is the caller's business.
 * @param className extra classes on the wrapper, for a caller with its own column widths.
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
      <tr>
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

export { buildComparisonGrid };
