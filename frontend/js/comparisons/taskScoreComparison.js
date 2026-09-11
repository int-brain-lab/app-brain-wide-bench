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
import { clearContent, getElement, refreshIcons, renderHtml, setText } from "../core/render.js";
import {
  metricLabel,
  suiteFromTask,
  suiteLabel,
  taskFullLabel,
  taskTypeLabel,
  taskTypeOf,
} from "../core/suites.js";
import { loadTaskSubmission } from "../api/taskSubmissionApi.js";
import { REGION_TASK_TYPE, toScoreDetail } from "../utils/recordingScoreUtils.js";
import { SERIES_COLOURS } from "../plots/palette.js";
import {
  SCORE_RANGE,
  buildScoreHeatmaps,
  createCategoryPlot,
  createMeanPlot,
} from "../plots/taskScorePlots.js";
import { createTaskPlot } from "../plots/recordPlots.js";
import { buildMetricBadge, buildTaskBadge } from "../components/badges.js";
import { buildToggle } from "../components/buttons.js";
import { buildPicks, dropFromClick } from "../components/comparisonGrid.js";
import { buildEmptyMessage } from "../components/messages.js";
import { buildSections, getSection, getSectionBody } from "../components/sections.js";
import { createComparison } from "./comparison.js";
import { MAX_COMPARED } from "./limits.js";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

// One section holds the whole reading: a row per task type, its mean beside its recordings.
const SCORES_SECTION = "scores";

// A row is one task type, and the two cells in it are found under it — see renderGroupRows.
const GROUP_ROW = "group";
const MEANS_SLOT = "[data-role='means']";
const PLOTS_SLOT = "[data-role='plots']";

const PICKS_ID = "score-picks";
const PROMPT_ID = "score-prompt";

// The line beside the view toggle saying what the rows under it are — see renderHint.
const HINT_ID = "score-hint";

const EMPTY_PROMPT = `Select up to ${MAX_COMPARED} task scores to compare them`;

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

// The task always, not only where several are in play: a pick is one model's score on one
// task, and a chip that named only the model would stand for something narrower than it is.
function labelOf(pick) {
  const task = taskFullLabel(pick.taskId);
  const name = pick.modelName ?? pick.submissionLabel;

  return name ? `${name} · ${task}` : task;
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
  return [...keys].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
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

// What a mean card is of: the metric it is drawn in, then the suite and task type it belongs
// to — "BAcc  TS1 Categorical". The suite comes off the scores rather than from the type,
// which is a fact about the numbers and not about which suite asked for them.
function buildMeanBadges(group, metric) {
  const suite = suiteFromTask(group.scores[0]?.taskId ?? "");

  const name = [suiteLabel(suite), taskTypeLabel(group.key)].filter(Boolean).join(" ");

  // Not `left`: the two say different things — what is drawn, and what it is of — so they
  // read as the card's two ends rather than as a pair.
  return `
    <span class="row gap-sm">
      ${buildMetricBadge(metric, "sm")}
      ${buildTaskBadge(name, suite ?? "ts-neutral", "sm")}
    </span>
  `;
}

// One badge per metric the task type reports, the one the plot above is read in lit. A row
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
 * @param meansContainer where the mean of each score is drawn, for a host with a place of its
 *                    own for it. The metric it is read in is chosen inside that card either
 *                    way. Omit for the panel's own section.
 * @param options     as createComparison. `toPick` makes a pick of
 *                    `{ key, taskId, submissionId, submissionLabel, modelName, colour? }`;
 *                    a host handing picks to `setPicks` makes them itself.
 * @returns the comparison — see createComparison.
 */
function createTaskComparison({
  container,
  nested = false,
  showPicks = true,
  meansContainer = null,
  ...options
}) {
  let view = BARS_VIEW;
  let comparison = null;

  // Keyed by task type.
  const selectedMetrics = new Map();

  let taskTypeGroups = [];

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
      label: labelOf(pick),
    };
  }

  function allScores() {
    return picks().map(toScore);
  }

  // What both panels walk every score for. Only on a pick or a fetch: a view or metric change
  // moves neither the picks nor their details.
  function updateGroups() {
    const scores = picks().map(toScore);

    taskTypeGroups = toTaskTypeGroups(scores);

    ({ recordings: uniqueRecordings, regions: uniqueRegions } = toCategories(scores));
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
    uniqueRecordings = [];
    uniqueRegions = [];

    renderPicks();

    getSection(SCORES_SECTION).hidden = true;

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

  // A row per task type, its mean on the left and its own recordings to the right of it —
  // a fifth of the row against four, see `.section-row.ratio-5`. Split by type rather than
  // pooled: a behavioural readout and a
  // neural reconstruction share neither a metric nor a scale, so the plots of one are not
  // read against the plots of the other.
  //
  // Written whenever the groups move, since a row *is* a group. Nested there are no rows: the
  // host draws the mean itself and the recordings stack in the one column it gave us.
  function renderGroupRows() {
    if (nested) return;

    renderHtml(
      getSectionBody(SCORES_SECTION),
      `
        <div class="column gap-lg">
          ${taskTypeGroups
            .map(
              (group) => `
            <div
              class="section-row ratio-5"
              data-${GROUP_ROW}="${escapeHtml(group.key)}"
            >
              <div data-role="means"></div>
              <div data-role="plots"></div>
            </div>`,
            )
            .join("")}
        </div>
      `,
    );
  }

  // The row of badges that says what the plot above it is read in.
  function buildMetricChoice(taskType, metric) {
    const choice = document.createElement("div");

    renderHtml(choice, buildMetricBadges(taskType, metric));

    return choice;
  }

  function getGroupSlot(key, slot) {
    return getSectionBody(SCORES_SECTION)?.querySelector(`[data-${GROUP_ROW}="${key}"] ${slot}`);
  }

  // One task type's mean, a bar per pick, and under it the choice of what to read it in.
  // Nested the card is the one the breakdown draws — the task and the metric named inside it
  // — where standalone it is this panel's own, headed by buildMeanBadges.
  function buildMeanCell(group) {
    const metric = metricFor(group.key);

    const labels = new Map(group.scores.map((score) => [score.key, score.label]));

    const series = toMeanSeries(group.scores, metric);
    const categories = group.scores.map((score) => score.key);
    const categoryLabel = (key) => labels.get(key);

    if (nested) {
      const plot = createTaskPlot({
        series,
        categories,
        categoryLabel,
        task: group.scores[0]?.taskId ?? "",
        yRange: SCORE_RANGE,
        height: 150,
      });

      plot.element.dataset[METRIC_GROUP] = group.key;
      plot.element.appendChild(buildMetricChoice(group.key, metric));

      meanCharts.push(plot.chart);

      return plot.element;
    }

    const plot = createMeanPlot({
      series,
      categories,
      categoryLabel,
      height: 150,
    });

    // What is drawn, the plot of it, and the choice of what to draw — one card, in that
    // order. `METRIC_GROUP` on it is what the badge listener reads the task type off.
    const cell = document.createElement("div");

    cell.className = "card column gap-lg";
    cell.dataset[METRIC_GROUP] = group.key;

    renderHtml(cell, buildMeanBadges(group, metric));
    cell.appendChild(plot.element);

    cell.appendChild(buildMetricChoice(group.key, metric));

    meanCharts.push(plot.chart);

    return cell;
  }

  function renderMeans() {
    clearMeans();

    if (!taskTypeGroups.length) return;

    // Nested, every mean goes in the one container the host gave us — and there is only ever
    // the one task there, so it is one card in practice.
    if (meansContainer) {
      const grid = document.createElement("div");

      grid.className = "column gap-lg";

      for (const group of taskTypeGroups) {
        grid.appendChild(buildMeanCell(group));
      }

      resolveContainer(meansContainer).replaceChildren(grid);

      return;
    }

    for (const group of taskTypeGroups) {
      getGroupSlot(group.key, MEANS_SLOT)?.replaceChildren(buildMeanCell(group));
    }
  }

  // By group, so comparable plots sit together. A score whose type has not loaded is in no
  // group and is left out.
  // One task type's recordings, a plot per score over the categories that type is measured
  // on. Three across standalone, one per row nested, where the column sits beside the task.
  function buildPlotCells(group) {
    const element = document.createElement("div");

    element.className = nested ? "column gap-lg" : "grid-3 gap-xs";

    const categories = categoriesFor(group.key);

    for (const series of toScoreSeries(group.scores, metricFor(group.key))) {
      const plot = createCategoryPlot({ series, categories, height: 100 });

      // A card each, as the mean plots and the task plots are, and nothing in it but the
      // plot: every one of these is the metric named on the mean beside them, so a badge per
      // card would say the same thing a dozen times.
      const cell = document.createElement("div");

      cell.className = "card column gap-xs";

      cell.appendChild(plot.element);

      plotCharts.push(plot.chart);
      element.appendChild(cell);
    }

    return element;
  }

  function renderRecordings() {
    clearPlots();

    // Nested, the whole section is the recordings: no rows to fill and no heatmap, the host
    // having given this panel one narrow column beside the task it is of.
    if (nested) {
      const wrapper = document.createElement("div");

      wrapper.className = "column gap-lg";

      for (const group of taskTypeGroups) {
        wrapper.appendChild(buildPlotCells(group));
      }

      getSectionBody(SCORES_SECTION).replaceChildren(wrapper);

      return;
    }

    for (const group of taskTypeGroups) {
      const slot = getGroupSlot(group.key, PLOTS_SLOT);

      if (!slot) continue;

      // A block per way of measuring, and a row is one of those — so a task type's heatmap
      // sits where its plots would.
      if (view === HEATMAP_VIEW) {
        renderHtml(
          slot,
          buildScoreHeatmaps({
            allSeries: toScoreSeries(group.scores, metricFor(group.key)),
            categoriesFor,
          }),
        );

        continue;
      }

      slot.replaceChildren(buildPlotCells(group));
    }
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

    getSection(SCORES_SECTION).hidden = false;

    // renderHint();
    renderGroupRows();
    renderMeans();
    renderRecordings();

    refreshIcons();
  }

  // ─── VIEW CONTROLS ─────────────────────────────────────────────────────────

  // What the rows below are showing. Written beside the toggle that changes it, and rewritten
  // when it does. Nothing to write nested: there the toggle is the host's, and so is the
  // heading over it.
  function renderHint() {
    const hint = getElement(HINT_ID);

    if (!hint) return;

    const rows = "One row per task type: its mean score per pick on the left,";

    setText(
      hint,
      view === HEATMAP_VIEW
        ? `${rows} and a cell per recording on the right.`
        : `${rows} and a plot per recording on the right.`,
    );
  }

  function setActiveView(selected) {
    for (const { id } of VIEWS) {
      getElement(id)?.classList.toggle("primary-inv", id === selected);
    }
  }

  function setView(selected) {
    if (selected === view) return;

    view = selected;
    setActiveView(view);
    // renderHint();
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
      getSectionBody(SCORES_SECTION),
      meansContainer ? resolveContainer(meansContainer) : null,
    ]) {
      root?.addEventListener("click", (event) => {
        const badge = event.target.closest(`[data-role="${METRIC}"]`);

        if (!badge) return;

        const key = badge.closest(`[data-${METRIC_GROUP}]`)?.dataset[METRIC_GROUP];

        // The lit one: clicking it would tear the plots down and build them again the same.
        if (!key || badge.value === metricFor(key)) return;

        selectedMetrics.set(key, badge.value);

        renderMeans();
        renderRecordings();
      });
    }
  }

  // ─── SETUP ─────────────────────────────────────────────────────────────────

  function setup() {
    // Untitled — a plot of scores says what it is, and the panel is opened by the rows above
    // it rather than found by its heading. Nested, the toggle is the host's too — see
    // buildRecordingsToggle.
    const scores = {
      id: SCORES_SECTION,

      // What is being shown, opposite the choice of how to show it.
      controls: nested
        ? ""
        : `<span class="card metadata bold action-hint" id="${HINT_ID}"></span>`,
      actions: nested ? [] : [buildToggle(VIEWS)],
    };

    renderHtml(
      container,
      `
        ${
          showPicks
            ? `<span
               class="row left gap-sm compare-picks push-down"
               id="${PICKS_ID}"
             ></span>`
            : ""
        }

        ${buildSections([scores])}

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

// `always`: a scores list is read by picking rows off it, so there is no button to press
// first and none to press to stop. The panel appears under the list as soon as one row is
// ticked, and it is untitled — the plots say what they are.
const SCORE_PANEL = {
  always: true,

  create: (container) => createTaskComparison({ container, toPick: toScorePick }),
};

export { SCORE_PANEL, buildRecordingsToggle, createTaskComparison };
