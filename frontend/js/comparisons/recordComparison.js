// Compare several records side by side.
//
// A record can be a model, submission, or another entity supplied by the host. The host
// provides:
// - `toPick`     how a row becomes a comparison pick
// - `details`    how its attributes are displayed
// - `readScores` where its task scores come from
//
// Everything else is shared between record types.
//
// The comparison has three views:
//
//   Details     one column per record
//   Breakdown   scores for every task
//   Difference  scores relative to a selected baseline
//
// Breakdown and Difference can be shown as plots or a table. The Details panel can also be
// docked below the score panels.
//
// A task selected from either score plot is shown in a task comparison below the panels.

import { escapeHtml } from "../core/html.js";
import { buildEmptyMessage, buildInfoMessage } from "../components/messages.js";
import { getElement, renderHtml } from "../core/render.js";
import {buildSections, getSection, getSectionBody} from "../components/sections.js";
import {
  TABLE_VIEW,
  PLOT_VIEW,
  buildPlotTableToggle,
} from "../components/buttons.js";
import {
  buildComparisonGrid,
  buildPicks,
  dropFromClick,
} from "../components/comparisonGrid.js";
import { createCompareTable } from "../tables/compareTable.js";
import { createModelsByTask } from "../plots/modelPlots.js";
import { SERIES_COLOURS } from "../plots/palette.js";
import {
  scoredTasksIn,
  diffMode,
  scoreMode,
  toCompareRows,
  toRecord,
} from "./compareData.js";
import { SUITES, suiteFromTask, suiteLabel } from "../core/suites.js";
import { createComparison } from "./comparison.js";
import { createTaskComparison } from "./taskScoreComparison.js";
import { buildOptions, buildSelect } from "../components/filters.js";
import { createTabDock } from "../components/tabDock.js";
import { disposeAll } from "../core/disposable.js";


// ─── CONFIGURATION ───────────────────────────────────────────────────────────

const DETAILS = "summary";
const BREAKDOWN = "breakdown";
const DIFFERENCE = "differences";

const PANELS = "compare-panel";
const PICKS_ID = "compare-picks";
const TASK_ID = "compare-task";

// The breakdown leads, so it is the dock's anchor: the panel a comparison is opened to see,
// which cannot be sent below the others.
const TABS = [
  { value: BREAKDOWN, label: "Breakdown" },
  { value: DIFFERENCE, label: "Difference" },
  { value: DETAILS, label: "Details" },
];


// ─── DETAILS ─────────────────────────────────────────────────────────────────

function buildDetails(picks, details, colourOf) {
  return buildComparisonGrid({
    layout: "columns",
    attributes: details.attributes(),
    entities: picks.map((pick) => ({
      label: pick.name,
      ink: colourOf(pick.key),
      cells: details.cells(pick),
    })),
  });
}


// ─── SCORES ──────────────────────────────────────────────────────────────────

// The suites the picks have a score on, in SUITES order. Over the resolved scores rather
// than the picks, so readScores is not asked a second time.
function availableSuitesIn(scored) {
  const suites = new Set(
    scored
      .flatMap(({ scores }) => Object.keys(scores))
      .map(suiteFromTask)
      .filter(Boolean),
  );

  return SUITES.filter((suite) => suites.has(suite));
}

function buildBar(label, name, options, selected) {
  return `
    <span id="${name}" class="row left gap-md">
      <span class="metadata">${escapeHtml(label)}</span>
      <span class="inline-select">
        ${buildSelect({
          name,
          hook: "role",
          options,
          selected,
        })}
      </span>
    </span>`;
}

function buildSuiteSelect() {
  return buildBar("Task suite", "suite", [], "");
}

function buildBaselineSelect(noun) {
  return buildBar(`Select baseline ${noun}`, "baseline", [], "");
}


// ─── WIDGET ──────────────────────────────────────────────────────────────────

/**
 * Create a comparison widget for a generic record type.
 *
 * @param {HTMLElement} container
 * @param {string} noun
 * @param {number} max
 * @param {object} details
 * @param {Function} readScores (pick) => `{ [taskId]: { mean, sem, metric, … } }`.
 *                               null while the pick's scores have not arrived — the pick
 *                               is skipped. `{}` when it scored none of them — the pick is
 *                               kept and drawn as dashes. Called once per pick per render;
 *                               may allocate.
 * @param {boolean} showSuites
 * @param {string} referenceId the record the others are read against, badged "This model".
 *                             Omit where the host has no such record — a leaderboard's picks
 *                             are six models with no one of them the reader's own.
 * @param {object} options
 */
function createRecordComparison({
  container,
  noun = "record",
  max,
  details,
  readScores,
  showSuites = true,
  referenceId = "",
  tabView = true,
  ...options
}) {
  const nothingScored = `None of these ${noun}s has a scored task yet.`;

  // ─── State ────────────────────────────────────────────────────────────────

  let comparison = null;

  let view = PLOT_VIEW;

  let selectedSuite = "";
  let selectedBaseline = "";

  let records = [];
  let scoredTasks = [];
  let availableSuites = [];

  let breakdownCharts = [];
  let differenceCharts = [];

  let openTask = "";
  let taskDetail = null;

  // Arrange the panels in dockable tabs
  const dock = createTabDock({
    noun: "model",
    tabs: TABS,
    container,
    hasContent: () => (comparison?.picks().length ?? 0) > 0,
    onChange: renderPanel,
  });


  // ─── State helpers ────────────────────────────────────────────────────────


  function getBaseline() {
    return records.some((record) => record.key === selectedBaseline)
      ? selectedBaseline
      : records[0]?.key ?? "";
  }


  function updateScores() {
    const scored = comparison
      .picks()
      .map((pick) => ({ pick, scores: readScores(pick) }))
      .filter(({ scores }) => scores != null);

    availableSuites = availableSuitesIn(scored);
    const suite =
      showSuites && availableSuites.includes(selectedSuite) ? selectedSuite : "";

    records = scored.map(({ pick, scores }) => ({
      ...toRecord(pick, scores, suite),
      isReference: Boolean(referenceId) && pick.key === referenceId,
      colour: comparison.colourOf(pick.key),
    }));


    scoredTasks = scoredTasksIn(records);

  }


  // ─── Selected ────────────────────────────────────────────────────────────────

  function nSelected() {
    return comparison?.picks().length ?? 0;
  }


  function renderSelected() {
    const selectedRecords = comparison
      ? comparison.picks().map((pick) => ({
          key: pick.key,
          label: pick.name,
          ink: comparison.colourOf(pick.key),
        }))
      : [];

    renderHtml(
      getElement(PICKS_ID),
      buildPicks(selectedRecords),
      { refresh: true },
    );
  }


  // ─── Task detail ──────────────────────────────────────────────────────────

  function toTaskPicks(taskId) {
    return records.flatMap((record) => {
      const score = record.tasks[taskId];

      if (!score?.task_submission_id || !score.submission_id) {
        return [];
      }

      return [{
        key: score.task_submission_id,
        submissionId: score.submission_id,
        taskId,
        modelName: record.name,
        colour: record.colour,
      }];
    });
  }

  function ensureTaskDetail() {
    if (taskDetail) return taskDetail;

    taskDetail = createTaskComparison({
      container: getSectionBody(TASK_ID),
      showPicks: false,
      nested: true,
    });

    return taskDetail;
  }

  function markOpenPlot() {
    for (const panel of [BREAKDOWN, DIFFERENCE]) {
      const body = getSectionBody(panel);

      for (const plot of body?.querySelectorAll("[data-axis]") ?? []) {
        plot.classList.toggle(
          "selected",
          plot.dataset.axis === openTask,
        );
      }
    }
  }

  function renderTaskDetail() {
    const container = getSection(TASK_ID);

    if (!container) return;

    const picks = openTask ? toTaskPicks(openTask) : [];

    if (!picks.length) {
      openTask = "";
      container.hidden = true;
      taskDetail?.clear();
      markOpenPlot();
      return;
    }

    container.hidden = false;

    ensureTaskDetail().set(picks);

    markOpenPlot();
  }

  function closeTaskDetail() {
    openTask = "";
    renderTaskDetail();
  }


  // ─── Score panels ─────────────────────────────────────────────────────────

  function clearCharts() {
    disposeAll(breakdownCharts);
    disposeAll(differenceCharts);

    breakdownCharts = [];
    differenceCharts = [];
  }

  function renderBreakdown() {
    const section = getSectionBody(BREAKDOWN);

    disposeAll(breakdownCharts);
    breakdownCharts = [];

    if (!scoredTasks.length) {
      renderHtml(section, buildEmptyMessage(nothingScored));
      return;
    }

    const mode = scoreMode();

    if (view === PLOT_VIEW) {
      const plots = createModelsByTask({ records, scoredTasks, mode });

      section.replaceChildren(plots.element);
      breakdownCharts = plots.charts;
      return;
    }

    const { element, table } = createCompareTable({
      rows: toCompareRows(records, scoredTasks, mode),
      scoredTasks,
      mode: "score",
    });

    section.replaceChildren(element);
    breakdownCharts = [table];
  }

  function renderDifferences() {
    const section = getSectionBody(DIFFERENCE);

    disposeAll(differenceCharts);
    differenceCharts = [];

    if (!scoredTasks.length) {
      renderHtml(section, buildEmptyMessage(nothingScored));
      return;
    }

    if (records.length < 2) {
      renderHtml(
        section,
        buildInfoMessage(`Select a second ${noun} to see the difference.`),
      );
      return;
    }

    const mode = diffMode(records, getBaseline());

    if (view === PLOT_VIEW) {
      const plots = createModelsByTask({ records, scoredTasks, mode });

      section.replaceChildren(plots.element);
      differenceCharts = plots.charts;
      return;
    }

    const { element, table } = createCompareTable({
      rows: toCompareRows(records, scoredTasks, mode),
      scoredTasks,
      mode: "diff",
    });

    section.replaceChildren(element);
    differenceCharts = [table];
  }


  // ─── Selects ──────────────────────────────────────────────────────────────

  function renderSuiteOptions() {
    const select = getElement("suite")?.querySelector(
      "[data-role='suite']",
    );

    if (!select) return;

    renderHtml(
      select,
      buildOptions(
        availableSuites.map((suite) => ({
          value: suite,
          label: suiteLabel(suite),
        })),
        {
          selected: selectedSuite,
          placeholder: "All suites",
        },
      ),
    );
  }

  function renderBaselineOptions() {
    const select = getElement("baseline")?.querySelector(
      "[data-role='baseline']",
    );

    if (!select) return;

    renderHtml(
      select,
      buildOptions(
        records.map((record) => ({
          value: record.key,
          label: record.name,
        })),
        { selected: getBaseline() },
      ),
    );
  }


  // ─── View ─────────────────────────────────────────────────────────────────

  function viewButton(panel, mode) {
    return getElement(`${mode}-${panel}`);
  }

  function setActiveView() {
    for (const panel of [BREAKDOWN, DIFFERENCE]) {
      for (const mode of [PLOT_VIEW, TABLE_VIEW]) {
        viewButton(panel, mode)?.classList.toggle(
          "primary-inv",
          mode === view,
        );
      }
    }
  }

  function renderView(nextView) {
    if (nextView === view) return;

    view = nextView;
    setActiveView();
    renderPanel();
  }


  // ─── Rendering ────────────────────────────────────────────────────────────

  function renderPanel() {
    if (view !== PLOT_VIEW) {
      openTask = "";
    }

    const visibleTabs = dock.getVisibleTabs();

    if (visibleTabs.has(DETAILS)) {
      renderDetails();
    }

    if (visibleTabs.has(BREAKDOWN)) {
      renderBreakdown();
    }

    if (visibleTabs.has(DIFFERENCE)) {
      renderDifferences();
    }

    renderTaskDetail();
  }

  function renderDetails() {
    renderHtml(
      getSectionBody(DETAILS),
      buildDetails(
        comparison.picks(),
        details,
        comparison.colourOf,
      ),
    );
  }

  function renderSections() {
    clearCharts();
    updateScores();

    renderSelected();
    setActiveView();

    if (showSuites) {
      renderSuiteOptions();
    }

    renderBaselineOptions();

    dock.render();
    renderPanel();
  }

  function clearUp() {
    clearCharts();

    records = [];
    scoredTasks = [];
    availableSuites = [];

    if (!nSelected()) {
      closeTaskDetail();
      renderSelected();
    }

    dock.render();
  }


  // ─── Events ───────────────────────────────────────────────────────────────

  function attachEvents() {
    attachViewEvents();
    dock.attachTabEvents();
    attachPickEvents();
    attachPlotEvents();
    attachSelectEvents();
  }

  function attachViewEvents() {
    for (const panel of [BREAKDOWN, DIFFERENCE]) {
      for (const mode of [PLOT_VIEW, TABLE_VIEW]) {
        viewButton(panel, mode)?.addEventListener("click", () => {
          renderView(mode);
        });
      }
    }
  }

  function attachPickEvents() {
    getElement(PICKS_ID)?.addEventListener("click", (event) => {
      const key = dropFromClick(event);

      if (key) {
        comparison.drop(key);
      }
    });
  }

  function attachPlotEvents() {
    function handlePlotClick(event) {
      const plot = event.target?.closest?.("[data-axis]");

      if (!plot) return;

      openTask =
        plot.dataset.axis === openTask ? "" : plot.dataset.axis;

      renderTaskDetail();
    }

    for (const panel of [BREAKDOWN, DIFFERENCE]) {
      getSectionBody(panel)?.addEventListener(
        "click",
        handlePlotClick,
      );
    }
  }

  function attachSelectEvents() {
    if (showSuites) {
      getElement("suite").addEventListener("change", (event) => {
        selectedSuite = event.target.value;

        updateScores();
        renderBaselineOptions();
        renderPanel();
      });
    }

    getElement("baseline").addEventListener("change", (event) => {
      selectedBaseline = event.target.value;
      renderDifferences();
    });
  }


  // ─── Setup ────────────────────────────────────────────────────────────────

  function setup() {
    const pageHtml = `
      <span class="row left gap-sm compare-picks" id="${PICKS_ID}"></span>

      ${dock.buildTabs()}

      ${buildSections([
        {
          id: DETAILS,
          hidden: true,
        },
        {
          id: BREAKDOWN,
          title: "Task breakdown",
          actions: [
            showSuites ? buildSuiteSelect() : null,
            buildPlotTableToggle(BREAKDOWN),
          ],
          className: "chart-pickable",
          hidden: true,
        },
        {
          id: DIFFERENCE,
          title: "Differences",
          actions: [
            buildBaselineSelect(noun),
            buildPlotTableToggle(DIFFERENCE),
          ],
          className: "chart-pickable",
          hidden: true,
        },
      {
        id: TASK_ID,
        title: "Individual scores",
        hidden: true,
      }
      ])}

    `;

    renderHtml(container, pageHtml);

    attachEvents();

    comparison = createComparison({
      container: getSectionBody(DETAILS),
      max,
      prompt: `Select up to ${max} ${noun}s to compare them.`,
      palette: SERIES_COLOURS,

      render: renderSections,
      clearUp,

      ...options,
    });

    return comparison;
  }

  return setup();
}

export { createRecordComparison };

