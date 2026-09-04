// Chart.js, analogous to table.js and Tabulator.
//
// This module owns the Chart.js instance, the house defaults and the custom plugins. The
// plot kinds above it — scatter.js, bar.js — supply the datasets and the marks; nothing
// here knows what a recording or a task is, and colours always come from the caller so a
// plot and the UI that names a series stay consistent.

import { dispose } from "../core/disposable.js";
import { resolveContainer } from "../core/dom.js";
import { score } from "../core/utils.js";

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
    options: mergeOptions(options, createDefaults({ legend, tooltip })),
    plugins: [errorBars, legendGap],
  });
}

/**
 * A chart over categories, with the house axes and tooltip: the shape both canvas plot
 * kinds are. Built detached, for the caller to place.
 *
 * @param type      Chart.js chart type.
 * @param labels    the axis, as category keys — the keys themselves, so two series line up
 *                  on the same category even where the axis shows an abbreviation of it.
 * @param datasets  from toDatasets in figure.js.
 * @param axisTitle what the y axis is measured in.
 * @param tickLabel (key, index) => what the axis shows for that category, or null to leave
 *                  it unlabelled — Chart.js draws no tick label for a null.
 * @param span      {min, max} suggested for the y axis. Omit to let the values frame
 *                  themselves.
 * @param yGrid     y-axis grid overrides — see createBarPlot, which draws zero as a line.
 * @param title     a heading inside the plot. Omit for none.
 * @param height    plot height in px.
 * @param showAxis  false where the axis is repeated below, or unreadable at this width.
 * @param legend    whether the plot names its series.
 * @param caller    name used in the Chart.js availability error.
 * @returns { element, chart }.
 */
function createCategoryChart({
  type,
  labels,
  datasets,
  axisTitle,
  tickLabel,
  span,
  yGrid = {},
  title = null,
  height,
  showAxis = true,
  legend = true,
  caller = "createCategoryChart",
}) {
  const element = document.createElement("div");

  element.className = "chart-facet";

  const chart = createChart({
    container: element,
    type,
    data: { labels, datasets },
    legend,
    height,
    tooltip: {
      callbacks: {
        // The whole key, where the axis had room only for a short form of it.
        title: (items) => items[0]?.label ?? "",
        label: (item) => {
          const sem = item.dataset.sems?.[item.dataIndex];
          // `barNames` where the bars have been packed and a dataset is no longer one series
          // — see packLeft in bar.js.
          const name =
            item.dataset.barNames?.[item.dataIndex] ?? item.dataset.label;

          const value = `${score(item.raw)}${sem == null ? "" : ` ± ${score(sem)}`}`;

          return name ? `${name}: ${value}` : value;
        },
      },
    },
    options: {
      plugins: title
        ? { title: { display: true, text: title, align: "start", color: AXIS } }
        : {},
      scales: {
        x: {
          type: "category",
          // The marks stay where the labels are off: they say where the categories are and
          // how many, which a plot too narrow to name them still owes the reader. Chart.js
          // draws them from the grid config, so `drawOnChartArea` is what keeps the vertical
          // gridlines away — `grid.display: false` would take the marks with them.
          grid: {
            display: true,
            drawOnChartArea: false,
            drawTicks: true,
            tickLength: 4,
            tickColor: AXIS,
          },
          ticks: {
            display: showAxis,
            color: AXIS,
            // Every category, and the caller decides which of them are named: autoSkip
            // would drop them by width, which moves the labels as the panel resizes.
            autoSkip: false,
            callback: (_, index) => tickLabel(labels[index], index),
          },
        },
        y: {
          title: { display: true, text: axisTitle, color: AXIS },
          ...yGrid,
          ...(span ? { suggestedMin: span.min, suggestedMax: span.max } : {}),
        },
      },
    },
    caller,
  });

  return { element, chart };
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
  createCategoryChart,
  createChart,
  destroyChart,
};
