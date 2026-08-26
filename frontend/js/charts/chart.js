// Chart plumbing, the way table.js is table plumbing: this module owns the Chart.js
// instance, the house defaults and the pieces Chart.js has no primitive for, and a domain
// module — see recordingChart.js — supplies the datasets and whatever axes its data needs.
//
// Nothing here knows what a recording or a task is, and nothing here picks a colour: a
// caller passes colours in, so the series and the card that named it can't drift apart.

import { resolveContainer } from "../tables/table.js";

// The ink the chart is drawn in. Text wears text colours and never a series colour — a
// value in the series' own hue reads as another mark rather than as a label.
const AXIS = "#666";
const GRID = "#ededed";
const SURFACE = "#fff";

// What a whisker is drawn in when it lies on top of a filled mark rather than beside a dot.
// A bar's own colour would swallow it, and the series is already identified by the fill —
// so the spread is drawn in ink, the way a value's text is.
const SEM_INK = "#1a1a1a";

/**
 * The series' colour, striped with the surface behind it — a second channel for a filled
 * mark, which has no shape to change when the hues come round again (see seriesStyle).
 *
 * A CanvasPattern rather than an opacity or a lighter tint: those read as "less" of the
 * value, which on a chart of quantities is exactly the wrong thing to say. The legend fills
 * its swatch from the same value, so the key shows the stripes too.
 */
function hatch(colour) {
  const tile = document.createElement("canvas");

  tile.width = 6;
  tile.height = 6;

  const ctx = tile.getContext("2d");

  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, 6, 6);

  // Drawn twice, offset by the tile, so the stripe runs unbroken across the seam.
  ctx.strokeStyle = SURFACE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-1, 7);
  ctx.lineTo(7, -1);
  ctx.moveTo(2, 10);
  ctx.lineTo(10, 2);
  ctx.stroke();

  return ctx.createPattern(tile, "repeat");
}

// ─── ERROR BARS ─────────────────────────────────────────────────────────────

/**
 * Whiskers from each point's own `sem`, drawn after the datasets.
 *
 * A plugin because Chart.js has no error-bar element and the alternatives are worse: a
 * shaded band needs two synthetic datasets per series, which then appear in the legend and
 * in every tooltip.
 *
 * The spread rides on the dataset either way — `sems[i]` beside a plain value, or `sem` on
 * an object point — so a series always carries its own, and can never be drawn with
 * another's. `semColor` overrides the ink for a mark the series' own colour would swallow.
 */
const errorBars = {
  id: "errorBars",

  afterDatasetsDraw(chart) {
    const { ctx } = chart;

    ctx.save();
    ctx.lineWidth = 1.5;

    chart.data.datasets.forEach((dataset, index) => {
      const meta = chart.getDatasetMeta(index);

      if (meta.hidden) return;

      ctx.strokeStyle = dataset.semColor ?? dataset.borderColor;

      meta.data.forEach((point, i) => {
        const value = dataset.data[i];
        const y = value !== null && typeof value === "object" ? value.y : value;
        const sem =
          dataset.sems?.[i] ??
          (value !== null && typeof value === "object" ? value.sem : null);

        if (sem == null || y == null) return;

        const scale = chart.scales[meta.yAxisID ?? "y"];
        const top = scale.getPixelForValue(y + sem);
        const bottom = scale.getPixelForValue(y - sem);
        // Narrower than the marker, so the whisker reads as its spread rather than as a
        // second mark sitting on top of it.
        const cap = 3;

        ctx.beginPath();
        ctx.moveTo(point.x, top);
        ctx.lineTo(point.x, bottom);
        ctx.moveTo(point.x - cap, top);
        ctx.lineTo(point.x + cap, top);
        ctx.moveTo(point.x - cap, bottom);
        ctx.lineTo(point.x + cap, bottom);
        ctx.stroke();
      });
    });

    ctx.restore();
  },
};

// The gap between the legend and the top of the plot, in pixels.
const LEGEND_GAP = 16;

/**
 * Pushes the plot down, away from the legend.
 *
 * Chart.js sizes the legend box to its labels exactly, so the first row of marks starts
 * immediately underneath it and the two read as one block. Patching `fit` is the hook for
 * it: `labels.padding` moves the legend items apart from each other, and `layout.padding`
 * moves the legend as well as the plot, so neither opens this particular gap.
 */
const legendGap = {
  id: "legendGap",

  beforeInit(chart) {
    const { legend } = chart;
    const fit = legend.fit;

    legend.fit = function fitWithGap() {
      fit.call(this);

      // Guarded, or a chart with no legend gains an inch of empty space above it.
      if (this.options.display) this.height += LEGEND_GAP;
    };
  },
};

// ─── DEFAULTS ───────────────────────────────────────────────────────────────

// Recessive axes and grid, a legend whichever way the caller leans, and hover on by
// default: an HTML chart is interactive, and a reader who can't ask a mark what it is has
// to go back to the table for every value.
function defaults({ legend = true, tooltip = {} } = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,

    // Off: Chart.js grows its marks from the origin, so for the first second a reader is
    // looking at positions that aren't the data's. Redrawing on every metric change would
    // replay it each time, and there is nothing here whose change needs narrating.
    animation: false,
    interaction: { mode: "nearest", intersect: true },
    plugins: {
      legend: {
        display: legend,
        position: "top",
        align: "start",
        labels: {
          color: AXIS,
          boxWidth: 10,
          boxHeight: 10,
          usePointStyle: true,
        },
      },
      tooltip: {
        backgroundColor: "#1a1a1a",
        padding: 10,
        displayColors: true,
        ...tooltip,
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          color: AXIS,
          maxRotation: 90,
          minRotation: 45,
          autoSkip: false,
        },
      },
      y: {
        grid: { color: GRID },
        border: { display: false },
        ticks: { color: AXIS },
      },
    },
  };
}

// Two levels is all the shapes here need — `scales.y` merges, `scales.y.ticks` replaces —
// and a general deep merge would quietly merge Chart.js's own array options too.
function withDefaults(options, base) {
  const merged = { ...base, ...options };

  for (const key of ["plugins", "scales"]) {
    merged[key] = { ...base[key], ...(options[key] ?? {}) };

    for (const inner of Object.keys(merged[key])) {
      merged[key][inner] = { ...base[key]?.[inner], ...options[key]?.[inner] };
    }
  }

  return merged;
}

// ─── CHART ──────────────────────────────────────────────────────────────────

/**
 * Mounts a Chart.js canvas, replacing whatever the container held.
 *
 * @param container element, or the id of one.
 * @param type      Chart.js type. "line" with `showLine: false` is the dot plot.
 * @param data      {labels, datasets} — the domain module's business.
 * @param options   merged over the defaults above, two levels deep.
 * @param height    css height for the canvas's box. A responsive canvas needs a sized
 *                  parent or it collapses to nothing.
 * @param legend    false to drop the legend — for a single series, which the title names.
 * @param caller    name used in error messages.
 * @returns the Chart instance, so a caller can update() or destroy() it.
 */
function createChart({
  container,
  type = "line",
  data,
  options = {},
  height = 320,
  legend = true,
  tooltip,
  caller = "createChart",
}) {
  if (typeof Chart === "undefined") {
    throw new Error(
      `${caller}: Chart.js is not loaded — add its <script> to the page.`,
    );
  }

  const root = resolveContainer(container, caller);

  root.innerHTML = `<div class="chart-box" style="height:${height}px"><canvas></canvas></div>`;

  return new Chart(root.querySelector("canvas"), {
    type,
    data,
    options: withDefaults(options, defaults({ legend, tooltip })),
    plugins: [errorBars, legendGap],
  });
}

// Chart.js keeps a live registry keyed on the canvas, so a chart whose container is about
// to be rewritten has to be told — otherwise it goes on responding to resizes and the next
// chart on that canvas throws.
function destroyChart(chart) {
  chart?.destroy?.();
}

export { AXIS, GRID, SEM_INK, SURFACE, createChart, destroyChart, hatch };
