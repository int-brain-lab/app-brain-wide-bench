// Compare several task scores side by side.
//
// A score is identified by `pick.key` and may provide:
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
import { taskLabel, taskTypeOf } from "../core/suites.js";

import {
  buildComparisonGrid,
  buildPicks,
  dropFromClick,
} from "../components/comparisonGrid.js";

import {
  buildScoreHeatmaps,
  createScoreMeans,
  createScoresByRecording,
  toMeanSeries,
  toScoreSeries,
} from "../plots/recordingScorePlots.js";

import { createBarPlot } from "../plots/bar.js";
import { createScatterPlot } from "../plots/scatter.js";

import {
  GRID,
  PAIR,
  STACK,
  TRACKS_PER_LINE,
  WEIGHTED,
} from "../plots/figure.js";
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

// The cell a metric group is drawn in, addressed by the group's own key — which is what
// `selectedMetrics` is keyed on, so a change reads straight into it.
const METRIC_GROUP = "metrics";

const SEPARATE_VIEW = "separate-view";
const BARS_VIEW = "bars-view";
const HEATMAP_VIEW = "heatmap-view";

const VIEWS = [
  { id: SEPARATE_VIEW, label: "Separate", icon: "cards" },
  { id: BARS_VIEW, label: "Bars", icon: "score" },
  { id: HEATMAP_VIEW, label: "Heatmap", icon: "suite" },
];


// ─── MOUNTINGS ───────────────────────────────────────────────────────────────
//
// What differs between the two ways this component is mounted:
//
//   sideBySide  means beside recordings rather than above them.
//   meanTracks  how many of the page's tracks the means grid spans — see TRACKS_PER_LINE.
//   meanHeight  what one mean plot stands at, in px.
//   recordings  (count) => the arrangement for that many scores.

// On its own, in the task-scores list.
const STANDALONE = {
  sideBySide: false,
  meanTracks: TRACKS_PER_LINE,
  meanHeight: 160,
  recordings: () => ({ ...GRID, height: 200 }),
};

// Under a record comparison's plots.
const NESTED = {
  sideBySide: true,
  meanTracks: 1,
  meanHeight: 200,
  recordings: (count) =>
    count < 4 ? { ...STACK, height: 120 } : { ...PAIR, height: 160 },
};


// ─── SCORE DATA ──────────────────────────────────────────────────────────────

// The recording store is cached against the fetched detail object.
// Re-selecting a score therefore reuses its already-loaded recording data.
const stores = new WeakMap();

function storeOf(pick) {
  const detail = pick.detail;

  if (!detail) return EMPTY_STORE;

  let store = stores.get(detail);

  if (!store) {
    store = toRecordingStore(detail.score?.metrics?.recordings);
    stores.set(detail, store);
  }

  return store;
}

function colourOf(pick, comparison) {
  return pick.colour ?? comparison.colourOf(pick.key);
}

// A score's label is contextual: with one task in play the name alone tells the picks apart,
// with several it does not. `multipleTasks` is that fact about the whole set — see updateGroups.
function labelOf(pick, multipleTasks) {
  const name = pick.modelName ?? pick.submissionLabel;

  if (!name) return pick.taskId;
  if (!multipleTasks) return name;

  return `${name} · ${pick.taskId}`;
}


// ─── METRIC GROUPS ────────────────────────────────────────────────────────────

// Grouped by the *set* of metrics a score has, because one plot and one metric selector can
// only serve scores measured the same way. The key is that set, sorted so order can't split a
// group in two.
function toMetricGroups(picks) {
  const groups = new Map();

  for (const pick of picks) {
    const metrics = Object.keys(storeOf(pick).metrics);

    // The score has not loaded yet.
    if (!metrics.length) continue;

    const key = metrics.slice().sort().join("|");

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        metrics,
        picks: [],
      });
    }

    groups.get(key).picks.push(pick);
  }

  return [...groups.values()];
}

// What a group's plot is titled: a group can span tasks — same metrics, different task — so
// the title has to say which.
function groupLabel(group) {
  return [...new Set(
    group.picks
      .map(({ taskId }) => taskLabel(taskId))
      .filter(Boolean),
  )].join(" · ");
}


// ─── MEANS ───────────────────────────────────────────────────────────────────

function buildMetricSelect(group, metric) {
  return `
    <span class="row left gap-md">
      <span class="metadata">Selected metric:</span>
      <span>
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

function buildMethodologyGrid(picks, fields, comparison, nameOf) {
  return buildComparisonGrid({
    attributes: methodologyColumns(fields),
    entities: picks.map((pick) => ({
      label: nameOf(pick),
      ink: colourOf(pick, comparison),
      cells: methodologyCells({
        record: pick.detail ?? null,
        fields,
      }),
    })),
  });
}


// ─── COMPONENT ───────────────────────────────────────────────────────────────

/**
 * Create a comparison of task scores.
 *
 * A pick must be — off `options.toPick`, or handed to `set` directly:
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
 * `showPicks` controls whether the component owns the score-selection row.
 *
 * `methodology` controls whether the methodology panel is shown.
 *
 * `nested` says which mounting this is — see STANDALONE and NESTED above.
 */
function createTaskComparison({
  container,
  nested = false,
  showPicks = true,
  methodology = true,
  ...options
}) {
  const arrangement = nested ? NESTED : STANDALONE;

  const panels = methodology
    ? TABS
    : TABS.filter(({ value }) => value === ANCHOR);

  const hasTabs = panels.length > 1;

  const dock = createTabDock({
    noun: "scores",
    tabs: panels,
    container,
    hasContent: (value) =>
      value === METHODOLOGY_PANEL || picks().length > 0,
    onChange: render,
  });

  let view = SEPARATE_VIEW;
  let comparison = null;

  // Metric choice is stored per metric combination rather than per plot index.
  const selectedMetrics = new Map();

  let metricGroups = [];
  let multipleTasks = false;

  let meanCharts = [];
  let plotCharts = [];


  // ─── STATE ────────────────────────────────────────────────────────────────

  function picks() {
    return comparison?.picks() ?? [];
  }

  // Both derived from the pick set, once per render rather than per consumer: toMetricGroups
  // walks every pick's store, and the means and recordings panels both want the answer.
  function updateGroups() {
    const held = picks();

    metricGroups = toMetricGroups(held);
    multipleTasks = new Set(held.map(({ taskId }) => taskId)).size > 1;
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

    for (const group of metricGroups) {
      const metric = metricFor(group);

      for (const pick of group.picks) {
        result.set(pick.key, metric);
      }
    }

    return result;
  }

  function nameOf(pick) {
    return labelOf(pick, multipleTasks);
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

    metricGroups = [];
    multipleTasks = false;

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
        picks().map((pick) => ({
          key: pick.key,
          label: nameOf(pick),
          ink: colourOf(pick, comparison),
        })),
      ),
      { refresh: true },
    );
  }

  function renderMeans() {
    const section = getSectionBody(MEANS_SECTION);

    clearMeans();

    getSection(MEANS_SECTION).hidden = metricGroups.length === 0;

    if (!metricGroups.length) {
      renderHtml(section, "");
      return;
    }

    // The grid arrangePlots can't do: a metric select above each plot, which it has nowhere
    // to put. Built as elements rather than markup, so each cell is in hand when its chart is
    // made — and assembled detached, then swapped in once, as the other two panels are.
    const grid = document.createElement("div");

    grid.className = WEIGHTED.className;
    grid.style.setProperty(
      "--plot-tracks",
      String(arrangement.meanTracks),
    );

    for (const group of metricGroups) {
      const metric = metricFor(group);

      const cell = document.createElement("div");

      cell.className = "column gap-sm";
      cell.dataset[METRIC_GROUP] = group.key;

      renderHtml(cell, buildMetricSelect(group, metric));

      const plots = createScoreMeans({
        allSeries: group.picks.map((pick) =>
          toMeanSeries({
            store: storeOf(pick),
            metric,
            taskType: taskTypeOf(pick.taskId),
            colour: colourOf(pick, comparison),
            label: nameOf(pick),
          }),
        ),
        label: groupLabel(group),
        height: arrangement.meanHeight,
      });

      cell.appendChild(plots.element);
      grid.appendChild(cell);

      meanCharts.push(...plots.charts);
    }

    section.replaceChildren(grid);
  }

  function renderMethodology() {
    renderHtml(
      getSectionBody(METHODOLOGY_SECTION),
      buildMethodologyGrid(
        picks(),
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

    const allSeries = picks().map((pick) =>
      toScoreSeries({
        store: storeOf(pick),
        metric: metricByScore.get(pick.key),
        taskType: taskTypeOf(pick.taskId),
        colour: colourOf(pick, comparison),
        label: nameOf(pick),
      }),
    );

    if (view === HEATMAP_VIEW) {
      renderHtml(section, buildScoreHeatmaps({ allSeries }));
      return;
    }

    const plots = createScoresByRecording({
      ...arrangement.recordings(allSeries.length),
      allSeries,
      createPlot: view === BARS_VIEW ? createBarPlot : createScatterPlot,
    });

    section.replaceChildren(plots.element);
    plotCharts = plots.charts;
  }

  function render() {
    updateGroups();

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

        const key = select.closest(`[data-${METRIC_GROUP}]`)?.dataset[
          METRIC_GROUP
        ];

        if (!key) return;

        selectedMetrics.set(key, select.value);

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
        ${showPicks
          ? `<span
               class="row left gap-sm compare-picks"
               id="${PICKS_ID}"
             ></span>`
          : ""
        }

        ${hasTabs ? dock.buildTabs() : ""}

        <div id="${SCORES_PANEL}">
          ${buildSections(
            arrangement.sideBySide
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

      loadDetail: (pick) =>
        loadTaskSubmission(
          pick.submissionId,
          pick.key,
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

