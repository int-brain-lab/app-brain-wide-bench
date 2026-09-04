// Compare several task scores side by side.
//
// A score is identified by `entry.key` and may provide:
//   - means:     one bar per score for each metric
//   - methodology: one score per column and training field per row
//   - recordings: the recordings behind each score
//
// Scores are grouped by their complete set of metrics. A metric selector is
// shown for each group, so every score in that plot is measured in the same way.
//
// `createComparison` owns score selection, loading and colours. This component
// owns how those scores are displayed.

import { disposeAll } from "../core/disposable.js";
import {
  clearContent,
  getElement,
  renderHtml,
} from "../core/render.js";
import { escapeHtml } from "../core/html.js";
import { taskLabel } from "../core/suites.js";

import {
  buildComparisonGrid,
  buildPicks,
  dropFromClick,
} from "../components/comparisonGrid.js";

import {
  buildRecordingHeatmaps,
  createMeanBars,
  createRecordingBars,
  createRecordingPlots,
  toMeanSeries,
  toScoreSeries,
} from "../plots/recordingScorePlots.js";

import { CATEGORIES_PER_LINE, SHARED_HEIGHT } from "../plots/figure.js";
import { SERIES_COLOURS } from "../plots/palette.js";

import { loadTaskSubmission } from "../api/taskSubmissionApi.js";
import { TASK_FIELDS } from "../schemas/taskSubmissionSchema.js";

import {
  methodologyCells,
  methodologyColumns,
} from "../components/methodologyGrid.js";

import {
  EMPTY_STORE,
  toRecordingStore,
} from "../utils/recordingScoreUtils.js";

import { createComparison } from "./comparison.js";

import {
  buildSections,
  getSection,
  getSectionBody,
} from "../components/sections.js";

import { buildToggle } from "../components/buttons.js";
import { createTabDock } from "../components/tabDock.js";
import { buildSelect } from "../components/filters.js";


// ─── CONFIGURATION ───────────────────────────────────────────────────────────

const MAX_COMPARED = 6;

const MEANS_SECTION = "means";
const METHODOLOGY_SECTION = "methodology";
const RECORDINGS_SECTION = "recordings";

const SCORES_PANEL = "score-panel";
const METHODOLOGY_PANEL = "methodology-panel";

const TABS = [
  { value: SCORES_PANEL, label: "Scores" },
  { value: METHODOLOGY_PANEL, label: "Methodology" },
];

const ANCHOR = SCORES_PANEL;

const PICKS_ID = "score-picks";
const PROMPT_ID = "score-prompt";

const METRIC = "metric";
const GROUP = "group";

const SEPARATE_VIEW = "separate-view";
const BARS_VIEW = "bars-view";
const HEATMAP_VIEW = "heatmap-view";

const VIEWS = [
  { id: SEPARATE_VIEW, label: "Separate", icon: "cards" },
  { id: BARS_VIEW, label: "Bars", icon: "score" },
  { id: HEATMAP_VIEW, label: "Heatmap", icon: "suite" },
];


// ─── SCORE DATA ──────────────────────────────────────────────────────────────

// The recording store is cached against the fetched detail object.
// Re-selecting a score therefore reuses its already-loaded recording data.
const stores = new WeakMap();

function storeOf(entry) {
  const detail = entry.detail;

  if (!detail) return EMPTY_STORE;

  let store = stores.get(detail);

  if (!store) {
    store = toRecordingStore(detail.score?.metrics?.recordings);
    stores.set(detail, store);
  }

  return store;
}

function colourOf(entry, comparison) {
  return entry.colour ?? comparison.colourOf(entry.key);
}

function labelOf(entry, entries) {
  const name = entry.modelName ?? entry.submissionLabel;
  const multipleTasks = new Set(entries.map(({ taskId }) => taskId)).size > 1;

  if (!name) return entry.taskId;
  if (!multipleTasks) return name;

  return `${name} · ${entry.taskId}`;
}


// ─── METRIC GROUPS ────────────────────────────────────────────────────────────

function metricsOf(entry) {
  return Object.keys(storeOf(entry).metrics);
}

function combinationOf(entry) {
  return metricsOf(entry).slice().sort().join("|");
}

function toMetricGroups(entries) {
  const groups = new Map();

  for (const entry of entries) {
    const metrics = metricsOf(entry);

    // The score has not loaded yet.
    if (!metrics.length) continue;

    const key = combinationOf(entry);

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        metrics,
        entries: [],
      });
    }

    groups.get(key).entries.push(entry);
  }

  return [...groups.values()];
}

function tasksIn(group) {
  return [...new Set(
    group.entries
      .map(({ taskId }) => taskLabel(taskId))
      .filter(Boolean),
  )].join(" · ");
}


// ─── MEANS ───────────────────────────────────────────────────────────────────

function buildMetricSelect(group, metric) {
  return `
    <span class="row left gap-md">
      <span class="metadata">Metric</span>
      <span class="inline-select">
        ${buildSelect({
          name: METRIC,
          hook: "role",
          options: group.metrics.map((name) => ({
            value: name,
            label: name,
          })),
          selected: metric,
        })}
      </span>
    </span>
  `;
}


// ─── METHODOLOGY ─────────────────────────────────────────────────────────────

function buildMethodologyGrid(entries, fields, comparison, nameOf) {
  return buildComparisonGrid({
    attributes: methodologyColumns(fields),
    entities: entries.map((entry) => ({
      label: nameOf(entry),
      ink: colourOf(entry, comparison),
      cells: methodologyCells({
        record: entry.detail ?? null,
        fields,
      }),
    })),
  });
}


// ─── COMPONENT ───────────────────────────────────────────────────────────────

/**
 * Create a comparison of task scores.
 *
 * `options.toEntry` must return:
 *
 *   {
 *     key,
 *     taskId,
 *     submissionId,
 *     submissionLabel,
 *     modelName,
 *     colour?
 *   }
 *
 * `picks` controls whether the component owns the score-selection row.
 *
 * `methodology` controls whether the methodology panel is shown.
 *
 * `layout: "rows"` places means beside recordings.
 */
function createTaskComparison({
  container,
  layout = "",
  picks = true,
  methodology = true,
  ...options
}) {
  const beside = layout === "rows";

  const panels = methodology
    ? TABS
    : TABS.filter(({ value }) => value === ANCHOR);

  const hasTabs = panels.length > 1;

  const dock = createTabDock({
    noun: "scores",
    tabs: panels,
    container,
    hasContent: (value) =>
      value === METHODOLOGY_PANEL || entries().length > 0,
    onChange: render,
  });

  const meanHeight = hasTabs ? null : SHARED_HEIGHT;

  let view = SEPARATE_VIEW;
  let comparison = null;

  // Metric choice is stored per metric combination rather than per plot index.
  const selectedMetrics = new Map();

  let meanCharts = [];
  let plotCharts = [];


  // ─── STATE ────────────────────────────────────────────────────────────────

  function entries() {
    return comparison?.entries() ?? [];
  }

  function groups() {
    return toMetricGroups(entries());
  }

  function metricFor(group) {
    const selected = selectedMetrics.get(group.key);

    if (selected && group.metrics.includes(selected)) {
      return selected;
    }

    return group.metrics[0] ?? "";
  }

  function metricsByScore() {
    const result = new Map();

    for (const group of groups()) {
      const metric = metricFor(group);

      for (const entry of group.entries) {
        result.set(entry.key, metric);
      }
    }

    return result;
  }

  function nameOf(entry) {
    return labelOf(entry, entries());
  }


  // ─── CLEANUP ──────────────────────────────────────────────────────────────

  function clearMeans() {
    disposeAll(meanCharts);
    meanCharts = [];
  }

  function clearPlots() {
    disposeAll(plotCharts);
    plotCharts = [];
  }

  function clearUp() {
    clearMeans();
    clearPlots();

    renderPicks();

    getSection(MEANS_SECTION).hidden = true;
    getSection(RECORDINGS_SECTION).hidden = true;

    if (!methodology) {
      clearContent(getElement(PROMPT_ID));
    }

    dock.render();
  }


  // ─── RENDERING ────────────────────────────────────────────────────────────

  function renderPicks() {
    const row = getElement(PICKS_ID);

    if (!row) return;

    renderHtml(
      row,
      buildPicks(
        entries().map((entry) => ({
          key: entry.key,
          label: nameOf(entry),
          ink: colourOf(entry, comparison),
        })),
      ),
      { refresh: true },
    );
  }

  function renderMeans() {
    const section = getSectionBody(MEANS_SECTION);
    const metricGroups = groups();

    clearMeans();

    getSection(MEANS_SECTION).hidden = metricGroups.length === 0;

    if (!metricGroups.length) {
      renderHtml(section, "");
      return;
    }

    renderHtml(
      section,
      `
        <div
          class="chart-weighted"
          style="--plot-tracks:${beside ? 1 : CATEGORIES_PER_LINE}"
        >
          ${metricGroups.map((group, index) => `
            <div
              class="column gap-sm"
              data-${GROUP}="${index}"
            >
              ${buildMetricSelect(group, metricFor(group))}
            </div>
          `).join("")}
        </div>
      `,
    );

    for (const [index, group] of metricGroups.entries()) {
      const metric = metricFor(group);

      const plots = createMeanBars({
        entries: group.entries.map((entry) =>
          toMeanSeries(
            storeOf(entry),
            metric,
            {
              colour: colourOf(entry, comparison),
              label: nameOf(entry),
            },
            group.key,
          ),
        ),
        label: tasksIn(group),
        height: meanHeight,
      });

      section
        .querySelector(`[data-${GROUP}="${index}"]`)
        ?.appendChild(plots.element);

      meanCharts.push(...plots.charts);
    }
  }

  function renderMethodology() {
    renderHtml(
      getSectionBody(METHODOLOGY_SECTION),
      buildMethodologyGrid(
        entries(),
        TASK_FIELDS,
        comparison,
        nameOf,
      ),
      { refresh: true },
    );
  }

  function renderRecordings() {
    const section = getSectionBody(RECORDINGS_SECTION);

    clearPlots();

    const metricByScore = metricsByScore();

    const plotEntries = entries().map((entry) =>
      toScoreSeries(
        storeOf(entry),
        metricByScore.get(entry.key),
        {
          colour: colourOf(entry, comparison),
          label: nameOf(entry),
        },
      ),
    );

    if (view === HEATMAP_VIEW) {
      renderHtml(
        section,
        buildRecordingHeatmaps({ entries: plotEntries }),
      );
      return;
    }

    const draw =
      view === BARS_VIEW
        ? createRecordingBars
        : createRecordingPlots;

    const layout = hasTabs
      ? plotEntries.length < 4
        ? "stack"
        : "pair"
      : "grid";

    const plots = draw({
      entries: plotEntries,
      facet: "score",
      layout,
    });

    section.replaceChildren(plots.element);
    plotCharts = plots.charts;
  }

  function render() {
    setActiveView(view);
    renderPicks();

    dock.render();
    renderPanel();
  }

  function renderPanel() {
    const visible = dock.getVisibleTabs();

    if (visible.has(SCORES_PANEL)) {
      getSection(RECORDINGS_SECTION).hidden = false;

      renderMeans();
      renderRecordings();
    }

    if (visible.has(METHODOLOGY_PANEL)) {
      renderMethodology();
    }
  }


  // ─── VIEW CONTROLS ────────────────────────────────────────────────────────

  function setActiveView(selected) {
    for (const { id } of VIEWS) {
      getElement(id)?.classList.toggle(
        "primary-inv",
        id === selected,
      );
    }
  }

  function setView(selected) {
    if (selected === view) return;

    view = selected;
    setActiveView(view);
    renderRecordings();
  }


  // ─── EVENTS ───────────────────────────────────────────────────────────────

  function attachEvents() {
    getElement(PICKS_ID)?.addEventListener("click", (event) => {
      const key = dropFromClick(event);

      if (key) {
        comparison.drop(key);
      }
    });

    for (const { id } of VIEWS) {
      getElement(id)?.addEventListener("click", () => {
        setView(id);
      });
    }

    dock.attachTabEvents();

    getSectionBody(MEANS_SECTION).addEventListener(
      "change",
      (event) => {
        const select = event.target.closest(
          `[data-role="${METRIC}"]`,
        );

        if (!select) return;

        const index = Number(
          select.closest(`[data-${GROUP}]`)?.dataset[GROUP],
        );

        const group = groups()[index];

        if (!group) return;

        selectedMetrics.set(group.key, select.value);

        renderMeans();
        renderRecordings();
      },
    );
  }


  // ─── SETUP ────────────────────────────────────────────────────────────────

  function setup() {
    const means = {
      id: MEANS_SECTION,
      title: "Mean scores",
    };

    const grid = {
      id: METHODOLOGY_SECTION,
      title: "Methodology",
    };

    const recordings = {
      id: RECORDINGS_SECTION,
      title: "Recordings",
      actions: [buildToggle(VIEWS)],
    };

    renderHtml(
      container,
      `
        ${picks
          ? `<span
               class="row left gap-sm compare-picks"
               id="${PICKS_ID}"
             ></span>`
          : ""
        }

        ${hasTabs ? dock.buildTabs() : ""}

        <div id="${SCORES_PANEL}">
          ${buildSections(
            beside
              ? [
                  {
                    sections: [means, recordings],
                    ratio: 4,
                  },
                ]
              : [means, recordings],
          )}
        </div>

        ${
          methodology
            ? `
              <div id="${METHODOLOGY_PANEL}">
                ${buildSections([grid])}
              </div>
            `
            : `<div id="${PROMPT_ID}"></div>`
        }
      `,
    );

    attachEvents();

    comparison = createComparison({
      container: methodology
        ? getSectionBody(METHODOLOGY_SECTION)
        : getElement(PROMPT_ID),

      max: MAX_COMPARED,

      prompt:
        `Select up to ${MAX_COMPARED} task scores to compare them.`,

      palette: SERIES_COLOURS,

      loadDetail: (entry) =>
        loadTaskSubmission(
          entry.submissionId,
          entry.key,
        ),

      render,
      clearUp,

      ...options,
    });

    return comparison;
  }

  return setup();
}

export {
  MAX_COMPARED,
  createTaskComparison,
};

