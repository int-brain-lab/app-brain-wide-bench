// A heatmap, in HTML rather than on a canvas.
//
// Chart.js has no matrix chart — it needs a second plugin for one view — and a grid of
// coloured boxes is a grid of coloured boxes: cells are elements, so the row labels are
// real text, a cell can be hovered for its value, and the whole thing prints and copies.
//
// Generic in the same way chart.js is: it knows about columns, rows and a ramp, and nothing
// about recordings or scores. What a cell means is the caller's — see recordingChart.js.

import { escapeHtml } from "../core/utils.js";
import { SEQUENTIAL } from "./palette.js";

// The bucket a value falls in, as an index into the ramp. Discrete rather than a continuous
// gradient: five steps a reader can match against a key beat a smooth wash they can only
// guess at, and the legend then has something to show.
function bucketOf(value, { min, max }) {
  if (value == null) return null;

  // A block where every value is the same is not a range to divide; it takes the top step,
  // which is what "all of it is the maximum" looks like.
  if (!(max > min)) return SEQUENTIAL.length - 1;

  const fraction = (value - min) / (max - min);

  return Math.min(
    SEQUENTIAL.length - 1,
    Math.max(0, Math.floor(fraction * SEQUENTIAL.length)),
  );
}

function buildCell(cell, range) {
  const bucket = bucketOf(cell?.value, range);

  // An absent value is a hole rather than the bottom of the ramp: "not measured here" and
  // "measured, and worst" are different answers and must not share a colour.
  if (bucket == null)
    return `<span class="heat-cell heat-empty" title="${escapeHtml(cell?.title ?? "")}"></span>`;

  return `
    <span
      class="heat-cell"
      style="background:${SEQUENTIAL[bucket]}"
      title="${escapeHtml(cell.title ?? "")}"
    ></span>`;
}

// Low to high, with the bounds written out: the ramp says which end is which, and the
// numbers say what the ends are.
function buildKey(range, format) {
  const swatches = SEQUENTIAL.map(
    (colour) => `<span class="heat-cell" style="background:${colour}"></span>`,
  ).join("");

  return `
    <span class="row left gap-sm metadata heat-key">
      <span>${escapeHtml(format(range.min))}</span>
      ${swatches}
      <span>${escapeHtml(format(range.max))}</span>
    </span>`;
}

/**
 * @param columns [{ key, label }] — the axis, in order.
 * @param rows    [{ label, sublabel, cells: [{ value, title }] }] — cells aligned to
 *                `columns` by position, so a row missing a column passes a null value
 *                rather than a shorter list.
 * @param range   { min, max } the ramp spans. Shared across every block of one metric by
 *                the caller, or two blocks of the same thing would be coloured differently.
 * @param title   what the block is measuring — the metric.
 * @param format  how a bound is written in the key.
 * @param labels  false to leave the column labels off, for an axis of unreadable ids.
 */
function buildHeatmap({
  columns,
  rows,
  range,
  title,
  format = (value) => String(value),
  labels = true,
}) {
  const header = labels
    ? `
      <div class="heat-row heat-header" style="--heat-columns:${columns.length}">
        <span class="heat-label"></span>
        ${columns.map((column) => `<span class="heat-column">${escapeHtml(column.label)}</span>`).join("")}
      </div>`
    : "";

  const body = rows
    .map(
      (row) => `
      <div class="heat-row" style="--heat-columns:${columns.length}">
        <span class="heat-label column gap-xs">
          <span class="label">${escapeHtml(row.label)}</span>
          ${row.sublabel ? `<span class="metadata">${escapeHtml(row.sublabel)}</span>` : ""}
        </span>
        ${row.cells.map((cell) => buildCell(cell, range)).join("")}
      </div>`,
    )
    .join("");

  return `
    <div class="column gap-sm heatmap">
      <div class="row">
        <span class="metadata">${escapeHtml(title)}</span>
        ${buildKey(range, format)}
      </div>
      ${header}
      ${body}
    </div>`;
}

export { buildHeatmap };
