// A grid of coloured cells, in HTML rather than on a canvas.
//
// Chart.js has no matrix chart — it needs a second plugin for one view — and a grid of
// coloured boxes is a grid of coloured boxes: cells are elements, so the row labels are
// real text, a cell can be hovered for its value, and the whole thing prints and copies.
//
// A different question from the plots rather than a prettier answer to theirs. A dot plot
// says how much; this says where — a column dark across every row is a category that is hard
// for all of them, and a pale row is a series that is behind everywhere rather than
// somewhere.

import { escapeHtml } from "../core/html.js";
import { score } from "../core/utils.js";
import {
  groupSeries,
  scaleKey,
  positionsIn,
  sharedAxes,
  sharedRanges,
} from "./figure.js";
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
 * @returns the markup.
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

/**
 * One block per metric, series down the rows and categories across.
 *
 * Blocked exactly as the plots are, and for the same two reasons: a cell's colour is a
 * scale, so two metrics can't share one, and a region is not a recording so they can't share
 * an axis — see figure.js.
 *
 * @param entries     the series.
 * @param tickLabel   (key, {group, index, count, columns}) => what a column is headed with
 *                    — as arrangePlots in figure.js. A block spans the page, so one column.
 * @param showColumns (group) => whether that block heads its columns at all, for an axis of
 *                    unreadable ids.
 * @param cellTitle   (key, mean, sem) => a cell's hover text.
 * @returns the markup.
 */
function buildHeatmaps({
  entries,
  tickLabel = (key) => key,
  showColumns = () => true,
  cellTitle = (key, mean, sem) =>
    mean == null
      ? `${key} — not measured`
      : `${key} · ${score(mean)}${sem == null ? "" : ` ± ${score(sem)}`}`,
}) {
  const blocks = groupSeries(entries, "metric");
  const axes = sharedAxes(entries, "value");
  const ranges = sharedRanges(entries);

  return blocks
    .map(([metric, members]) => {
      const group = members[0].group;
      const labels = axes.get(group) ?? [];
      const positions = members.map((entry) => positionsIn(entry, labels));

      return buildHeatmap({
        title: metric,
        range: ranges.get(scaleKey(members[0])) ?? { min: 0, max: 1 },
        format: (value) => score(value),
        labels: showColumns(group),
        columns: labels.map((key, column) => ({
          key,
          label: tickLabel(key, {
            group,
            index: column,
            count: labels.length,
            columns: 1,
          }),
        })),
        rows: members.map((entry, index) => ({
          label: entry.label,
          cells: labels.map((key, column) => {
            const at = positions[index][column];
            const mean = at < 0 ? null : entry.values.mean[at];
            const sem = at < 0 ? null : entry.values.sem[at];

            return { value: mean ?? null, title: cellTitle(key, mean, sem) };
          }),
        })),
      });
    })
    .join("");
}

export { buildHeatmap, buildHeatmaps };
