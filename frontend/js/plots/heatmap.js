// A grid of coloured cells, in HTML rather than on a canvas: cells are elements, so row
// labels are real text and a cell can be hovered for its value.

import { escapeHtml } from "../core/html.js";
import { score } from "../core/utils.js";
import { positionsOf } from "./figure.js";
import { SEQUENTIAL } from "./palette.js";

// Which step of the ramp a value falls on.
function bucketOf(value, { min, max }) {
  if (value == null) return null;

  // A block of one value has no range to divide; it takes the top step.
  if (!(max > min)) return SEQUENTIAL.length - 1;

  const fraction = (value - min) / (max - min);

  return Math.min(
    SEQUENTIAL.length - 1,
    Math.max(0, Math.floor(fraction * SEQUENTIAL.length)),
  );
}

function buildCell(cell, range) {
  const bucket = bucketOf(cell?.value, range);

  // An absent value is a hole, never the bottom of the ramp.
  if (bucket == null)
    return `<span class="heat-cell heat-empty" title="${escapeHtml(cell?.title ?? "")}"></span>`;

  return `
    <span
      class="heat-cell"
      style="background:${SEQUENTIAL[bucket]}"
      title="${escapeHtml(cell.title ?? "")}"
    ></span>`;
}

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
/**
 * One block of cells.
 *
 * @param columns    [{ key, label }] — the axis, in order.
 * @param rows       [{ label, sublabel, cells: [{ value, title }] }] — cells aligned to
 *                   `columns` by position, a missing one passing a null value.
 * @param range      { min, max } the ramp spans.
 * @param title      what the block is measuring.
 * @param format     how a bound is written in the key.
 * @param showHeader false to leave the column headings off.
 * @returns the markup.
 */
function buildHeatmap({
  columns,
  rows,
  range,
  title,
  format = (value) => String(value),
  showHeader,
}) {
  const header = showHeader
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

/**
 * One block per plot, series down the rows and categories across.
 *
 * @param plots      from withRanges — `{ axis, name, categories, range, series }` each.
 * @param xTickLabel (key, {axis, index, count, columns}) => what a column is headed with. A
 *                   block spans the page, so one column.
 * @param showHeader (axis) => whether that block heads its columns at all.
 * @param cellTitle  (key, mean, sem) => a cell's hover text.
 * @returns the markup.
 */
function buildHeatmaps({
  plots,
  xTickLabel,
  showHeader,
  cellTitle = (key, mean, sem) =>
    mean == null
      ? `${key} — not measured`
      : `${key} · ${score(mean)}${sem == null ? "" : ` ± ${score(sem)}`}`,
}) {
  return plots
    .map((plot) => {
      const positions = plot.series.map((series) =>
        positionsOf(series, plot.categories),
      );

      return buildHeatmap({
        title: plot.name,
        range: plot.yRange ?? { min: 0, max: 1 },
        format: (value) => score(value),
        showHeader: showHeader(plot.axis),
        columns: plot.categories.map((key, column) => ({
          key,
          label: xTickLabel(key, {
            axis: plot.axis,
            index: column,
            count: plot.categories.length,
            columns: 1,
          }),
        })),
        rows: plot.series.map((series, index) => ({
          label: series.label,
          cells: plot.categories.map((key, column) => {
            const at = positions[index][column];
            const mean = at < 0 ? null : series.values.mean[at];
            const sem = at < 0 ? null : series.values.sem[at];

            return { value: mean ?? null, title: cellTitle(key, mean, sem) };
          }),
        })),
      });
    })
    .join("");
}

export { buildHeatmaps };
