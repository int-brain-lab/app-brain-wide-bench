// Chart.js, as table.js is Tabulator.
//
// The Chart.js instance, the house defaults and the custom plugins. The plot kind above it —
// bar.js — supplies the datasets and the marks. Nothing here knows what a recording or a task
// is, and colours always come from the caller, so a plot and the UI naming its series cannot
// disagree.

import { resolveContainer } from "../core/dom.js";
import { score } from "../core/utils.js";

// ─── DEFAULTS ────────────────────────────────────────────────────────────────

const AXIS = "#666";
const GRID_INK = "#ededed";
const SEM_INK = "#1a1a1a";

const ERROR_BAR_CAP = 3;

// Plots stand as low as 120px.
const MAX_Y_TICKS = 5;

/**
 * Shared Chart.js configuration.
 *
 * Domain-specific options are merged over these defaults by createChart().
 */
function createDefaults({ tooltip = {} } = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,

    interaction: {
      mode: "nearest",
      intersect: true,
    },

    plugins: {
      // No chart here names its own series: a comparison's chips and a grid's headings do it
      // outside the plot, where they are read once rather than repeated per panel.
      legend: { display: false },

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
          autoSkip: false,
        },
      },

      y: {
        grid: {
          color: GRID_INK,
        },
        border: {
          display: false,
        },
        ticks: {
          color: AXIS,
          maxTicksLimit: MAX_Y_TICKS,
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

// ─── CHART ───────────────────────────────────────────────────────────────────

/**
 * Mount a Chart.js chart into a container.
 *
 * @param container element, or id of an element.
 * @param type Chart.js chart type.
 * @param data Chart.js data: { labels, datasets }.
 * @param options Chart.js options merged over the shared defaults.
 * @param height CSS height of the chart container.
 * @param tooltip tooltip overrides.
 */
function createChart({
  container,
  type,
  data,
  options,
  height,
  tooltip,
}) {
  if (typeof Chart === "undefined") {
    throw new Error(
      `createChart: Chart.js is not loaded — add its <script> to the page.`,
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
    options: mergeOptions(options, createDefaults({ tooltip })),
    plugins: [errorBars],
  });
}

/**
 * A chart over categories, with the house axes and tooltip: the shape both canvas plot
 * kinds are. Built detached, for the caller to place.
 *
 * @param type             Chart.js chart type.
 * @param categories       the x axis, as category keys — the keys themselves, so two series
 *                         line up even where the axis shows an abbreviation of one.
 * @param datasets         from toDatasets in series.js.
 * @param yAxisLabel       what the y axis is measured in. Omit for an unlabelled axis,
 *                         where the caller names the measure beside the plot.
 * @param xAxisLabel       what the categories are, named once under them. Omit for an
 *                         unlabelled axis.
 * @param xTickLabel       (key, index) => what the axis shows for that category. "" for a
 *                         tick with no name under it; null drops the tick mark as well.
 * @param categoryLabel    (key) => what a tooltip calls that category. Omit to show the key
 *                         itself, which is what an abbreviated axis owes the reader.
 * @param yRange           { min, max } suggested for the y axis. Omit to let the values
 *                         frame themselves.
 * @param yGrid            y-axis grid overrides — see createBarPlot, which draws zero as a
 *                         line.
 * @param xTickRotation    degrees to turn the x tick labels by. 0 for names short enough
 *                         to read across.
 * @param plotTitle        a heading inside the plot. Omit for none.
 * @param height           plot height in px.
 * @returns { element, chart }.
 */
function createCategoryChart({
  type,
  categories,
  datasets,
  yAxisLabel,
  xAxisLabel,
  xTickLabel,
  categoryLabel = (key) => key,
  xTickRotation,
  yRange,
  yGrid = {},
  plotTitle,
  height,
}) {
  const element = document.createElement("div");


  element.className = "chart-facet";
  const chart = createChart({
    container: element,
    type,
    data: { labels: categories, datasets },
    height,
    tooltip: {
      callbacks: {
        title: (items) =>
          items[0] ? (categoryLabel(items[0].label) ?? items[0].label) : "",
        label: (item) => {
          const sem = item.dataset.sems?.[item.dataIndex];
          const name = item.dataset.label;

          const value = `${score(item.raw)}${sem == null ? "" : ` ± ${score(sem)}`}`;

          return name ? `${name}: ${value}` : value;
        },
      },
    },
    options: {
      plugins: plotTitle
        ? { title: { display: true, text: plotTitle, align: "start", color: AXIS } }
        : {},
      scales: {
        x: {
          type: "category",

          // Tight to the axis: the label is the only thing under it.
          title: {
            display: Boolean(xAxisLabel),
            text: xAxisLabel,
            color: AXIS,
            padding: 0,
          },

          // Nothing under the axis but the label: no gridlines, and no marks either.
          grid: { display: false },
          ticks: {
            color: AXIS,
            padding: 0,
            minRotation: xTickRotation,
            maxRotation: xTickRotation,
            // autoSkip drops labels by width, which moves them as the panel resizes.
            autoSkip: false,
            callback: (_, index) => xTickLabel(categories[index], index),
          },
        },
        y: {
          title: { display: Boolean(yAxisLabel), text: yAxisLabel, color: AXIS },
          ...yGrid,
          ...(yRange
            ? { suggestedMin: yRange.min, suggestedMax: yRange.max }
            : {}),
        },
      },
    },
  });

  return { element, chart };
}

export { AXIS, GRID_INK, SEM_INK, createCategoryChart };
