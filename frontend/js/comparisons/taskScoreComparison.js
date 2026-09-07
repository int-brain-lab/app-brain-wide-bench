// Compare several task scores side by side, in two panels:
//
//   means        one bar per score, for the metric its task type is read in
//   recordings   the categories behind each score, as plots or a heatmap
//
// Scores are grouped by task type, so every score in one plot is measured the same way and
// can be offered the same metrics.
//
// `createComparison` owns the picks and the detail behind each. This component owns how
// those scores are drawn.

import { disposeAll } from "../core/disposable.js";
import { resolveContainer } from "../core/dom.js";
import { escapeHtml } from "../core/html.js";
import {
  clearContent,
  getElement,
  refreshIcons,
  renderHtml,
} from "../core/render.js";
import { metricLabel, taskTypeOf } from "../core/suites.js";
import { loadTaskSubmission } from "../api/taskSubmissionApi.js";
import {
  REGION_TASK_TYPE,
  toScoreDetail,
} from "../utils/recordingScoreUtils.js";
import { SERIES_COLOURS } from "../plots/palette.js";
import {
  SCORE_RANGE,
  buildScoreHeatmaps,
  createCategoryPlot,
  createMeanPlot,
} from "../plots/taskScorePlots.js";
import { createTaskPlot } from "../plots/recordPlots.js";
import { buildMetricBadge } from "../components/badges.js";
import { buildToggle } from "../components/buttons.js";
import { buildPicks, dropFromClick } from "../components/comparisonGrid.js";
import { buildEmptyMessage } from "../components/messages.js";
import {
  buildSections,
  getSection,
  getSectionBody,
} from "../components/sections.js";
import { createTableBinding } from "./binding.js";
import { createComparison } from "./comparison.js";


// ─── CONFIGURATION ───────────────────────────────────────────────────────────

const MAX_COMPARED = 6;

const MEANS_SECTION = "means";
const RECORDINGS_SECTION = "recordings";

const PICKS_ID = "score-picks";
const PROMPT_ID = "score-prompt";

const EMPTY_PROMPT = `Select up to ${MAX_COMPARED} task scores to compare them.`;

const METRIC = "metric";

// The data attribute a group's cell carries its task type in, which is what `selectedMetrics`
// is keyed on.
const METRIC_GROUP = "metrics";

const BARS_VIEW = "bars-view";
const HEATMAP_VIEW = "heatmap-view";

const VIEWS = [
  { id: BARS_VIEW, label: "Bars", icon: "score" },
  { id: HEATMAP_VIEW, label: "Heatmap", icon: "suite" },
];





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

// One badge per metric the task type reports, the one the plot below is read in lit. A row
// of them rather than a select: there are two or three, and which is being read is then on
// screen rather than behind a placeholder.
function buildMetricBadges(taskType, metric) {
  return `
    <span class="row left gap-lg">
      <span class="metadata">Metric:</span>
      <span class="row left gap-sm">
        ${metricsFor(taskType)
          .map(
            (name) => `
              <button
                type="button"
                class="badge metric${name === metric ? " on" : ""}"
                data-role="${METRIC}"
                value="${escapeHtml(name)}"
              >${escapeHtml(metricLabel(name))}</button>`,
          )
          .join("")}
      </span>
    </span>
  `;
}


/**
 * How the recordings are drawn, for a host placing it away from them — the buttons are found
 * by id, so it may sit anywhere on the page.
 *
 * @returns the markup.
 */
function buildRecordingsToggle() {
  return buildToggle(VIEWS);
}

// ─── COMPONENT ───────────────────────────────────────────────────────────────

/**
 * A comparison of task scores, drawn into `container`.
 *
 * @param container   element, or the id of one. Its contents are replaced.
 * @param nested      the narrower layout, for sitting beside a record comparison's plots.
 *                    Without the mean scores, which those plots already are — one bar per
 *                    record on the task this panel is open on.
 * @param showPicks   whether this owns the row of picked scores. Omit for a host that draws
 *                    its own.
 * @param metricsContainer where the metric each task type is read in is chosen, for a host
 *                    placing that control beside the plots rather than over them. Omit where
 *                    the mean cards carry it.
 * @param meansContainer where the mean of each score is drawn, for a host with a place of its
 *                    own for it. Omit for the panel's own section.
 * @param options     as createComparison. `toPick` makes a pick of
 *                    `{ key, taskId, submissionId, submissionLabel, modelName, colour? }`;
 *                    a host handing picks to `setPicks` makes them itself.
 * @returns the comparison — see createComparison.
 */
function createTaskComparison({
  container,
  nested = false,
  showPicks = true,
  metricsContainer = null,
  meansContainer = null,
  ...options
}) {
  let view = BARS_VIEW;
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
      taskId: pick.taskId,
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

    const means = getSection(MEANS_SECTION);

    if (means) means.hidden = true;
    getSection(RECORDINGS_SECTION).hidden = true;

    clearContent(getElement(PROMPT_ID));
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
    const target = meansContainer
      ? resolveContainer(meansContainer)
      : getSectionBody(MEANS_SECTION);

    clearMeans();

    if (!target) return;

    const section = getSection(MEANS_SECTION);

    if (section) section.hidden = taskTypeGroups.length === 0;

    if (!taskTypeGroups.length) {
      renderHtml(target, "");
      return;
    }

    // Elements rather than markup: each cell is in hand when its chart is made. Assembled
    // detached, then swapped in once.
    const grid = document.createElement("div");

    // Nested, the cells stack: the panel is too narrow for a row of them. They are cards, so
    // stacked they need the gap the grid would otherwise give them.
    grid.className = nested ? "column gap-lg" : "grid-6";

    for (const group of taskTypeGroups) {
      const metric = metricFor(group.key);

      const labels = new Map(
        group.scores.map((score) => [score.key, score.label]),
      );

      const series = toMeanSeries(group.scores, metric);
      const categories = group.scores.map((score) => score.key);
      const categoryLabel = (key) => labels.get(key);

      // Where a host placed the metric control, the card is the one the breakdown draws —
      // the task and the metric named inside it. Otherwise the badges are the control.
      const plot = metricsContainer
        ? createTaskPlot({
            series,
            categories,
            categoryLabel,
            task: group.scores[0]?.taskId ?? "",
            yRange: SCORE_RANGE,
            height: 150,
          })
        : createMeanPlot({ series, categories, categoryLabel, height: 150 });

      if (metricsContainer) {
        grid.appendChild(plot.element);
      } else {
        const cell = document.createElement("div");

        cell.className = "card column gap-lg";
        cell.dataset[METRIC_GROUP] = group.key;

        renderHtml(cell, buildMetricBadges(group.key, metric));
        cell.appendChild(plot.element);
        grid.appendChild(cell);
      }

      meanCharts.push(plot.chart);
    }

    target.replaceChildren(grid);
  }

  // By group, so comparable plots sit together. A score whose type has not loaded is in no
  // group and is left out.
  // One row of badges per task type, for a host that placed the control itself. Nothing to
  // draw where the mean cards carry it.
  function renderMetrics() {
    if (!metricsContainer) return;

    renderHtml(
      resolveContainer(metricsContainer),
      taskTypeGroups
        .map(
          (group) => `
        <span class="row left gap-sm" data-${METRIC_GROUP}="${group.key}">
          ${buildMetricBadges(group.key, metricFor(group.key))}
        </span>`,
        )
        .join(""),
    );
  }

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

    // Nested, one per row: the column they sit in is beside the task they are of.
    element.className = nested ? "column gap-lg" : "grid-3 gap-xs";

    for (const group of taskTypeGroups) {
      const categories = categoriesFor(group.key);

      for (const series of toScoreSeries(group.scores, metricFor(group.key))) {
        const plot = createCategoryPlot({
          series,
          categories,
          height: 100,
        });

        // A card each, as the mean plots and the task plots are. The badge names what the
        // plot is measured in; the one that chooses it is over the means.
        const cell = document.createElement("div");

        cell.className = "card column gap-xs";

        renderHtml(
          cell,
          `<span class="row left gap-sm">${buildMetricBadge(series.metric)}</span>`,
        );

        cell.appendChild(plot.element);

        plotCharts.push(plot.chart);
        element.appendChild(cell);
      }
    }

    section.replaceChildren(element);
  }

  function render(held) {
    if (!held.length) {
      renderHtml(getElement(PROMPT_ID), buildEmptyMessage(EMPTY_PROMPT));
      refreshIcons();

      return;
    }

    updateGroups();

    setActiveView(view);
    renderPicks();

    clearContent(getElement(PROMPT_ID));

    getSection(RECORDINGS_SECTION).hidden = false;

    renderMeans();
    renderMetrics();
    renderRecordings();

    refreshIcons();
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

    for (const root of [
      getSectionBody(MEANS_SECTION),
      metricsContainer ? resolveContainer(metricsContainer) : null,
    ]) {
      root?.addEventListener("click", (event) => {
        const badge = event.target.closest(`[data-role="${METRIC}"]`);

        if (!badge) return;

        const key = badge.closest(`[data-${METRIC_GROUP}]`)?.dataset[
          METRIC_GROUP
        ];

        // The lit one: clicking it would tear the plots down and build them again the same.
        if (!key || badge.value === metricFor(key)) return;

        selectedMetrics.set(key, badge.value);

        renderMeans();
        renderMetrics();
        renderRecordings();
      });
    }
  }


  // ─── SETUP ─────────────────────────────────────────────────────────────────

  function setup() {
    // Nested, there is no mean to draw: the plots beside this panel are that mean.
    const means = nested
      ? null
      : {
          id: MEANS_SECTION,
          title: "Mean scores",
        };

    // Nested, neither a heading nor a control of its own: the panel it sits in is named, and
    // its host places the toggle — see buildRecordingsToggle.
    const recordings = {
      id: RECORDINGS_SECTION,
      title: nested ? "" : "Recordings",
      actions: nested ? [] : [buildToggle(VIEWS)],
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

        ${buildSections(nested ? [recordings] : [means, recordings])}

        <div id="${PROMPT_ID}"></div>
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

// What the panel needs to start on a row. The per-recording breakdown it
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
      createTaskComparison({ container, toPick: toScorePick }),

    // `claimLinks: false`: the model and submission a score belongs to still link to their
    // own pages, and a click anywhere else on the row is a pick.
    bindTable: (controller) =>
      createTableBinding(controller, { claimLinks: false }),
  },
};

export {
  SCORE_MODES,
  buildRecordingsToggle,
  createTaskComparison,
};

