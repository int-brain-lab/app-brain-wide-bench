// Compare several task scores side by side, in three panels:
//
//   means        one bar per score, for the metric its task type is read in
//   recordings   the categories behind each score, as plots or a heatmap
//   methodology  one score per column, one training field per row
//
// Scores are grouped by task type, so every score in one plot is measured the same way and
// can be offered the same metrics.
//
// `createComparison` owns the picks and the detail behind each. This component owns how
// those scores are drawn.

import { disposeAll } from "../core/disposable.js";
import {
  clearContent,
  getElement,
  refreshIcons,
  renderHtml,
} from "../core/render.js";
import { taskTypeOf } from "../core/suites.js";
import { loadTaskSubmission } from "../api/taskSubmissionApi.js";
import { TASK_FIELDS } from "../schemas/taskSubmissionSchema.js";
import {
  REGION_TASK_TYPE,
  toScoreDetail,
} from "../utils/recordingScoreUtils.js";
import { createBarPlot } from "../plots/bar.js";
import { SERIES_COLOURS } from "../plots/palette.js";
import {
  buildScoreHeatmaps,
  createCategoryPlot,
  createMeanPlot,
} from "../plots/taskScorePlots.js";
import { createScatterPlot } from "../plots/scatter.js";
import { buildToggle } from "../components/buttons.js";
import {
  buildComparisonGrid,
  buildPicks,
  dropFromClick,
} from "../components/comparisonGrid.js";
import { buildSelect } from "../components/filters.js";
import { buildEmptyMessage } from "../components/messages.js";
import {
  methodologyCells,
  methodologyColumns,
} from "../components/methodologyGrid.js";
import {
  buildSections,
  getSection,
  getSectionBody,
} from "../components/sections.js";
import { createTabDock } from "../components/tabDock.js";
import { createTableBinding } from "./binding.js";
import { createComparison } from "./comparison.js";


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

const EMPTY_PROMPT = `Select up to ${MAX_COMPARED} task scores to compare them.`;

const METRIC = "metric";

// The data attribute a group's cell carries its task type in, which is what `selectedMetrics`
// is keyed on.
const METRIC_GROUP = "metrics";

const SEPARATE_VIEW = "separate-view";
const BARS_VIEW = "bars-view";
const HEATMAP_VIEW = "heatmap-view";

const VIEWS = [
  { id: SEPARATE_VIEW, label: "Separate", icon: "cards" },
  { id: BARS_VIEW, label: "Bars", icon: "score" },
  { id: HEATMAP_VIEW, label: "Heatmap", icon: "suite" },
];

const PLOT_HEIGHT = 200;



// ─── SCORE DATA ──────────────────────────────────────────────────────────────

// The metrics a task type reports, learned from the first score of that type to land, and
// kept for the life of the page.
const metricsByTaskType = new Map();

function rememberMetrics({ taskType, metrics }) {
  if (metricsByTaskType.has(taskType)) return;

  const names = Object.keys(metrics);

  if (names.length) metricsByTaskType.set(taskType, names);
}

function metricsFor(taskType) {
  return metricsByTaskType.get(taskType) ?? [];
}

function colourFor(pick, comparison) {
  return pick.colour ?? comparison.colourFor(pick.key);
}

// With several tasks in play the name alone does not tell the picks apart — see updateGroups.
function labelOf(pick, multipleTasks) {
  const name = pick.modelName ?? pick.submissionLabel;

  if (!name) return pick.taskId;
  if (!multipleTasks) return name;

  return `${name} · ${pick.taskId}`;
}


// ─── SERIES ──────────────────────────────────────────────────────────────────

// The categories the scores were measured over, in two buckets: a region is not a recording,
// so the two never share an axis.
function toCategories(scores) {
  const recordings = new Set();
  const regions = new Set();

  for (const score of scores) {
    const held = score.taskType === REGION_TASK_TYPE ? regions : recordings;

    for (const key of score.detail?.index.keys() ?? []) held.add(key);
  }

  return { recordings: sorted(recordings), regions: sorted(regions) };
}

// `numeric` so a key ending in 10 follows one ending in 2.
function sorted(keys) {
  return [...keys].sort((a, b) =>
    String(a).localeCompare(String(b), undefined, { numeric: true }),
  );
}

// A metric the score never recorded, or a detail that has not landed: a series of gaps
// rather than a missing series.
const NO_VALUES = { mean: [], sem: [] };

// One series per score, each over its own categories.
function toScoreSeries(scores, metric) {
  return scores.map(({ detail, taskType, colour, label }) => ({
    colour,
    label,
    metric,
    taskType,
    index: detail?.index ?? new Map(),
    values: detail?.metrics[metric] ?? NO_VALUES,
  }));
}

// A group's means as one plot series: a category per score, so a bar each.
function toMeanSeries(scores, metric) {
  return {
    label: null,
    colours: scores.map((score) => score.colour),
    metric,
    index: new Map(scores.map((score, at) => [score.key, at])),
    values: {
      mean: scores.map((score) => score.detail?.means[metric]?.mean ?? null),
      sem: scores.map((score) => score.detail?.means[metric]?.sem ?? null),
    },
  };
}

// Grouped by task type, which is what decides the metrics on offer and the axis drawn.
function toTaskTypeGroups(scores) {
  const groups = new Map();

  for (const score of scores) {
    const key = score.taskType;

    // No score of this type has loaded yet.
    if (!metricsFor(key).length) continue;

    if (!groups.has(key)) groups.set(key, { key, scores: [] });

    groups.get(key).scores.push(score);
  }

  return [...groups.values()];
}

// ─── MEANS ───────────────────────────────────────────────────────────────────

function buildMetricSelect(taskType, metric) {
  return `
    <span class="row left gap-md">
      <span class="metadata">Selected metric:</span>
      <span>
        ${buildSelect({
          name: METRIC,
          hook: "role",
          options: metricsFor(taskType).map((name) => ({
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

function buildMethodologyGrid(scores, fields) {
  return buildComparisonGrid({
    attributes: methodologyColumns(fields),
    entities: scores.map((score) => ({
      label: score.label,
      ink: score.colour,
      cells: methodologyCells({
        record: score.detail ?? null,
        fields,
      }),
    })),
  });
}


// ─── COMPONENT ───────────────────────────────────────────────────────────────

/**
 * A comparison of task scores, drawn into `container`.
 *
 * @param container   element, or the id of one. Its contents are replaced.
 * @param nested      the narrower layout, for sitting under a record comparison's plots.
 * @param showPicks   whether this owns the row of picked scores. Omit for a host that draws
 *                    its own.
 * @param methodology whether the methodology panel is offered. Without it there are no tabs,
 *                    and the empty prompt gets a strip of its own.
 * @param options     as createComparison. `toPick` makes a pick of
 *                    `{ key, taskId, submissionId, submissionLabel, modelName, colour? }`;
 *                    a host handing picks to `setPicks` makes them itself.
 * @returns the comparison — see createComparison.
 */
function createTaskComparison({
  container,
  nested = false,
  showPicks = true,
  methodology = true,
  ...options
}) {

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

  // Keyed by task type.
  const selectedMetrics = new Map();

  let taskTypeGroups = [];
  let multipleTasks = false;

  let uniqueRecordings = [];
  let uniqueRegions = [];

  let meanCharts = [];
  let plotCharts = [];


  // ─── STATE ─────────────────────────────────────────────────────────────────

  function picks() {
    return comparison?.picks() ?? [];
  }

  // A pick as the panels read it: its colour off the palette, its label off the whole set.
  function toScore(pick) {
    return {
      key: pick.key,
      taskType: taskTypeOf(pick.taskId),
      detail: pick.detail,
      colour: colourFor(pick, comparison),
      label: labelOf(pick, multipleTasks),
    };
  }

  function allScores() {
    return picks().map(toScore);
  }

  // What both panels walk every score for. Only on a pick or a fetch: a view or metric change
  // moves neither the picks nor their details.
  function updateGroups() {
    const held = picks();

    multipleTasks = new Set(held.map(({ taskId }) => taskId)).size > 1;

    const scores = held.map(toScore);

    taskTypeGroups = toTaskTypeGroups(scores);


    ({ recordings: uniqueRecordings, regions: uniqueRegions } =
      toCategories(scores));
  }

  // The methodology grid's own body where there is one: the grid fills it once something is
  // picked.
  function promptElement() {
    return methodology
      ? getSectionBody(METHODOLOGY_SECTION)
      : getElement(PROMPT_ID);
  }

  function categoriesFor(taskType) {
    return taskType === REGION_TASK_TYPE ? uniqueRegions : uniqueRecordings;
  }

  // The metric a task type is currently read in: the reader's choice while it is still one
  // this type reports, and its first otherwise.
  function metricFor(taskType) {
    const metrics = metricsFor(taskType);
    const selected = selectedMetrics.get(taskType);

    return selected && metrics.includes(selected) ? selected : (metrics[0] ?? "");
  }


  // ─── CLEANUP ───────────────────────────────────────────────────────────────

  function clearMeans() {
    disposeAll(meanCharts);
    meanCharts = [];
  }

  function clearPlots() {
    disposeAll(plotCharts);
    plotCharts = [];
  }

  function teardown() {
    clearMeans();
    clearPlots();

    taskTypeGroups = [];
    multipleTasks = false;
    uniqueRecordings = [];
    uniqueRegions = [];

    renderPicks();

    getSection(MEANS_SECTION).hidden = true;
    getSection(RECORDINGS_SECTION).hidden = true;

    if (!methodology) {
      clearContent(getElement(PROMPT_ID));
    }

    dock.render();
  }


  // ─── RENDERING ─────────────────────────────────────────────────────────────

  function renderPicks() {
    const row = getElement(PICKS_ID);

    if (!row) return;

    renderHtml(
      row,
      buildPicks(
        allScores().map((score) => ({
          key: score.key,
          label: score.label,
          ink: score.colour,
        })),
      ),
      { refresh: true },
    );
  }

  function renderMeans() {
    const section = getSectionBody(MEANS_SECTION);

    clearMeans();

    getSection(MEANS_SECTION).hidden = taskTypeGroups.length === 0;

    if (!taskTypeGroups.length) {
      renderHtml(section, "");
      return;
    }

    // Elements rather than markup: each cell is in hand when its chart is made. Assembled
    // detached, then swapped in once.
    const grid = document.createElement("div");

    // Nested, the cells stack: the panel is too narrow for a row of them.
    grid.className = nested ? "" : "grid-6";

    for (const group of taskTypeGroups) {
      const metric = metricFor(group.key);

      const cell = document.createElement("div");

      cell.className = "column gap-sm";
      cell.dataset[METRIC_GROUP] = group.key;

      renderHtml(cell, buildMetricSelect(group.key, metric));

      const labels = new Map(
        group.scores.map((score) => [score.key, score.label]),
      );

      const plot = createMeanPlot({
        series: toMeanSeries(group.scores, metric),
        categories: group.scores.map((score) => score.key),
        categoryLabel: (key) => labels.get(key),
        height: PLOT_HEIGHT,
      });

      cell.appendChild(plot.element);
      grid.appendChild(cell);

      meanCharts.push(plot.chart);
    }

    section.replaceChildren(grid);
  }

  function renderMethodology() {
    renderHtml(
      getSectionBody(METHODOLOGY_SECTION),
      buildMethodologyGrid(allScores(), TASK_FIELDS),
      { refresh: true },
    );
  }

  // By group, so comparable plots sit together. A score whose type has not loaded is in no
  // group and is left out.
  function renderRecordings() {
    const section = getSectionBody(RECORDINGS_SECTION);

    clearPlots();

    if (view === HEATMAP_VIEW) {
      const allSeries = taskTypeGroups.flatMap((group) =>
        toScoreSeries(group.scores, metricFor(group.key)),
      );

      renderHtml(section, buildScoreHeatmaps({ allSeries, categoriesFor }));
      return;
    }

    const element = document.createElement("div");

    // The class and `columns` below are one fact: the tick labels are thinned to the width a
    // plot is drawn at.
    element.className = nested ? "grid-2" : "grid-3";

    const createPlot = view === BARS_VIEW ? createBarPlot : createScatterPlot;

    for (const group of taskTypeGroups) {
      const categories = categoriesFor(group.key);

      for (const series of toScoreSeries(group.scores, metricFor(group.key))) {
        const plot = createCategoryPlot({
          series,
          categories,
          createPlot,
          columns: nested ? 2 : 3,
          height: PLOT_HEIGHT,
        });

        plotCharts.push(plot.chart);
        element.appendChild(plot.element);
      }
    }

    section.replaceChildren(element);
  }

  function render(held) {
    if (!held.length) {
      renderHtml(promptElement(), buildEmptyMessage(EMPTY_PROMPT));
      refreshIcons();

      return;
    }

    updateGroups();

    setActiveView(view);
    renderPicks();

    dock.render();
    renderPanel();

    refreshIcons();
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


  // ─── VIEW CONTROLS ─────────────────────────────────────────────────────────

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


  // ─── EVENTS ────────────────────────────────────────────────────────────────

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


  // ─── SETUP ─────────────────────────────────────────────────────────────────

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
            nested
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
      max: MAX_COMPARED,

      palette: SERIES_COLOURS,

      loadDetail: async (pick) => {
        const detail = toScoreDetail(
          await loadTaskSubmission(pick.submissionId, pick.key),
          taskTypeOf(pick.taskId),
        );

        rememberMetrics(detail);

        return detail;
      },

      render,
      teardown,

      ...options,
    });

    // The empty prompt. After the assignment above, which `render` reaches back through.
    comparison.refresh();

    return comparison;
  }

  return setup();
}

// ─── LIST PANEL ──────────────────────────────────────────────────────────────
//
// This comparison mounted under a task-scores list — see templates/listView.js for the shape.
// Shared because four pages show that list; modelView.js writes its own.

// What the panel needs to start on a row. The methodology and the per-recording breakdown it
// fetches for itself.
function toScorePick(row) {
  return {
    key: row.id,
    taskId: row.task_id,
    submissionId: row.submission_id,
    submissionLabel: row.submission_label,
    modelName: row.model_name,
  };
}

// `base` and no `active`: the panel is there from the list's first render, with its own
// prompt rather than a button to press first.
const SCORE_MODES = {
  base: {
    title: "Compare task scores",
    create: (container) =>
      createTaskComparison({ container, toPick: toScorePick, methodology: false }),

    // `claimLinks: false`: the model and submission a score belongs to still link to their
    // own pages, and a click anywhere else on the row is a pick.
    bindTable: (controller) =>
      createTableBinding(controller, { claimLinks: false }),
  },
};

export {
  MAX_COMPARED,
  SCORE_MODES,
  createTaskComparison,
};

