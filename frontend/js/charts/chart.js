// Chart plumbing, analogous to table.js.
//
// This module owns the Chart.js instance, shared defaults and custom Chart.js plugins.
// Domain modules provide the data and domain-specific axis configuration.
//
// Nothing here knows what a recording or task is, and series colours always come from the
// caller so the chart and the UI that names a series stay consistent.

import { resolveContainer } from "../core/dom.js";
import { dispose } from "../core/disposable.js";

// ─── DEFAULTS ────────────────────────────────────────────────────────────────

const AXIS = "#666";
const GRID = "#ededed";
const SURFACE = "#fff";
const SEM_INK = "#1a1a1a";

const DEFAULT_HEIGHT = 320;
const ERROR_BAR_CAP = 3;
const LEGEND_GAP = 16;

/**
 * Shared Chart.js configuration.
 *
 * Domain-specific options are merged over these defaults by createChart().
 */
function createDefaults({ legend = true, tooltip = {} } = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,

    interaction: {
      mode: "nearest",
      intersect: true,
    },

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
        backgroundColor: SEM_INK,
        padding: 10,
        displayColors: true,
        ...tooltip,
      },
    },

    scales: {
      x: {
        grid: {
          display: false,
        },
        ticks: {
          color: AXIS,
          maxRotation: 90,
          minRotation: 45,
          autoSkip: false,
        },
      },

      y: {
        grid: {
          color: GRID,
        },
        border: {
          display: false,
        },
        ticks: {
          color: AXIS,
        },
      },
    },
  };
}

/**
 * Merge chart options over the house defaults.
 *
 * Chart.js contains arrays and nested configuration objects, so a generic deep merge
 * would be more surprising than useful here. We only merge the two levels this module
 * actually exposes.
 */
function mergeOptions(options, defaults) {
  const merged = {
    ...defaults,
    ...options,
  };

  for (const key of ["plugins", "scales"]) {
    merged[key] = {
      ...defaults[key],
      ...(options[key] ?? {}),
    };

    for (const name of Object.keys(merged[key])) {
      merged[key][name] = {
        ...defaults[key]?.[name],
        ...options[key]?.[name],
      };
    }
  }

  return merged;
}

// ─── PATTERNS ────────────────────────────────────────────────────────────────

/**
 * Create a repeating diagonal hatch using the series colour and chart surface.
 *
 * The hatch gives filled marks a second visual channel without making the colour itself
 * appear lighter or less important.
 */
function hatch(colour) {
  const tile = document.createElement("canvas");

  tile.width = 6;
  tile.height = 6;

  const ctx = tile.getContext("2d");

  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, tile.width, tile.height);

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

// ─── ERROR BARS ──────────────────────────────────────────────────────────────

function getPointValue(value) {
  return value !== null && typeof value === "object" ? value.y : value;
}

function getPointSem(dataset, value, index) {
  return (
    dataset.sems?.[index] ??
    (value !== null && typeof value === "object" ? value.sem : null)
  );
}

function drawErrorBar(ctx, x, top, bottom) {
  ctx.beginPath();

  ctx.moveTo(x, top);
  ctx.lineTo(x, bottom);

  ctx.moveTo(x - ERROR_BAR_CAP, top);
  ctx.lineTo(x + ERROR_BAR_CAP, top);

  ctx.moveTo(x - ERROR_BAR_CAP, bottom);
  ctx.lineTo(x + ERROR_BAR_CAP, bottom);

  ctx.stroke();
}

/**
 * Chart.js plugin for drawing SEM whiskers.
 *
 * SEM can be supplied either as:
 *
 *   dataset.sems[index]
 *
 * or:
 *
 *   { x, y, sem }
 *
 * on an individual data point.
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

      const scale = chart.scales[meta.yAxisID ?? "y"];
      ctx.strokeStyle = dataset.semColor ?? dataset.borderColor;

      meta.data.forEach((point, i) => {
        const value = dataset.data[i];
        const y = getPointValue(value);
        const sem = getPointSem(dataset, value, i);

        if (y == null || sem == null) return;

        const top = scale.getPixelForValue(y + sem);
        const bottom = scale.getPixelForValue(y - sem);

        drawErrorBar(ctx, point.x, top, bottom);
      });
    });

    ctx.restore();
  },
};

// ─── LEGEND ──────────────────────────────────────────────────────────────────

/**
 * Adds a small gap between the legend and the plot.
 */
const legendGap = {
  id: "legendGap",

  beforeInit(chart) {
    const { legend } = chart;
    const originalFit = legend.fit;

    legend.fit = function fitWithGap() {
      originalFit.call(this);

      if (this.options.display) {
        this.height += LEGEND_GAP;
      }
    };
  },
};

// ─── CHART ───────────────────────────────────────────────────────────────────

/**
 * Mount a Chart.js chart into a container.
 *
 * @param container element, or id of an element.
 * @param type Chart.js chart type.
 * @param data Chart.js data: { labels, datasets }.
 * @param options Chart.js options merged over the shared defaults.
 * @param height CSS height of the chart container.
 * @param legend whether to show the legend.
 * @param tooltip tooltip overrides.
 * @param caller name used in the Chart.js availability error.
 */
function createChart({
  container,
  type = "line",
  data,
  options = {},
  height = DEFAULT_HEIGHT,
  legend = true,
  tooltip,
  caller = "createChart",
}) {
  if (typeof Chart === "undefined") {
    throw new Error(
      `${caller}: Chart.js is not loaded — add its <script> to the page.`,
    );
  }

  const root = resolveContainer(container);

  root.innerHTML = `
    <div class="chart-box" style="height:${height}px">
      <canvas></canvas>
    </div>
  `;

  const canvas = root.querySelector("canvas");

  return new Chart(canvas, {
    type,
    data,
    options: mergeOptions(
      options,
      createDefaults({ legend, tooltip }),
    ),
    plugins: [errorBars, legendGap],
  });
}

/**
 * Destroy a Chart.js instance before its container is replaced.
 */
function destroyChart(chart) {
  dispose(chart);
}

export {
  AXIS,
  GRID,
  SEM_INK,
  SURFACE,
  createChart,
  destroyChart,
  hatch,
};