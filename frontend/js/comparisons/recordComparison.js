// Compare several records side by side.
//
// A record can be a model, submission, or another entity supplied by the host. The host
// provides:
// - `toEntry`    how a row becomes a comparison record
// - `details`    how its attributes are displayed
// - `scoresOf`   where its task scores come from
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
import { createModelPlots } from "../plots/modelPlots.js";
import { SERIES_COLOURS } from "../plots/palette.js";
import {
  compareTasks,
  diffMode,
  scoreMode,
  toCompareEntries,
  toCompareRows,
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

function buildDetails(entries, details, colourOf) {
  return buildComparisonGrid({
    layout: "columns",
    attributes: details.attributes(),
    entities: entries.map((entry) => ({
      label: entry.name,
      ink: colourOf(entry.key),
      cells: details.cells(entry),
    })),
  });
}


// ─── SCORES ──────────────────────────────────────────────────────────────────

function scoresForRecords(entries, scoresOf, suite, colourOf) {
  const scored = entries.filter((entry) => scoresOf(entry) != null);

  const compared = toCompareEntries(
    scored,
    scoresOf,
    suite,
    entries[0]?.recordId,
  ).map((entry) => ({
    ...entry,
    colour: colourOf(entry.recordId),
  }));

  return {
    compared,
    tasks: compareTasks(compared),
  };
}

function availableSuites(entries, scoresOf) {
  const suites = new Set(
    entries
      .flatMap((entry) => Object.keys(scoresOf(entry) ?? {}))
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
 * @param {Function} scoresOf
 * @param {boolean} showSuites
 * @param {object} options
 */
function createRecordComparison({
  container,
  noun = "record",
  max,
  details,
  scoresOf,
  showSuites = true,
  tabView = true,
  ...options
}) {
  const nothingScored = `None of these ${noun}s has a scored task yet.`;

  // ─── State ────────────────────────────────────────────────────────────────

  let comparison = null;

  let view = PLOT_VIEW;

  let selectedSuite = "";
  let selectedBaseline = "";

  let compared = [];
  let tasks = [];

  let breakdownCharts = [];
  let differenceCharts = [];

  let openTask = "";
  let taskDetail = null;

  // Arrange the panels in dockable tabs
  const dock = createTabDock({
    noun: "model",
    tabs: TABS,
    container,
    hasContent: () => (comparison?.entries().length ?? 0) > 0,
    onChange: renderPanel,
  });


  // ─── State helpers ────────────────────────────────────────────────────────


  function getSuite() {

    return availableSuites(comparison.entries(), scoresOf).includes(selectedSuite)
      ? selectedSuite
      : "";
  }

  function getBaseline() {
    return compared.some(
      (entry) => entry.recordId === selectedBaseline,
    )
      ? selectedBaseline
      : compared[0]?.recordId ?? "";
  }

  function updateScores() {
    ({ compared, tasks } = scoresForRecords(
      comparison.entries(),
      scoresOf,
      getSuite(),
      comparison.colourOf,
    ));
  }


  // ─── Selected ────────────────────────────────────────────────────────────────

  function nSelected() {
    return comparison?.entries().length ?? 0;
  }


  function renderSelected() {
    const selectedRecords = comparison
      ? comparison.entries().map((entry) => ({
          key: entry.key,
          label: entry.name,
          ink: comparison.colourOf(entry.key),
        }))
      : [];

    renderHtml(
      getElement(PICKS_ID),
      buildPicks(selectedRecords),
      { refresh: true },
    );
  }


  // ─── Task detail ──────────────────────────────────────────────────────────

  function toTaskRows(taskId) {
    return compared.flatMap((entry) => {
      const score = entry.tasks[taskId];

      if (!score?.task_submission_id || !score.submission_id) {
        return [];
      }

      return [{
        taskSubmissionId: score.task_submission_id,
        submissionId: score.submission_id,
        taskId,
        modelName: entry.modelName ?? entry.recordName,
        submissionLabel: entry.submissionLabel ?? null,
        metric: score.metric,
        colour: entry.colour,
      }];
    });
  }

  function ensureTaskDetail() {
    if (taskDetail) return taskDetail;

    taskDetail = createTaskComparison({
      container: getSectionBody(TASK_ID),
      picks: false,
      layout: "rows",

      toEntry: (row) => ({
        key: row.taskSubmissionId,
        taskId: row.taskId,
        submissionId: row.submissionId,
        submissionLabel: row.submissionLabel,
        modelName: row.modelName,
        metric: row.metric,
        colour: row.colour,
      }),
    });

    return taskDetail;
  }

  function markOpenPlot() {
    for (const panel of [BREAKDOWN, DIFFERENCE]) {
      const body = getSectionBody(panel);

      for (const plot of body?.querySelectorAll("[data-group]") ?? []) {
        plot.classList.toggle(
          "selected",
          plot.dataset.group === openTask,
        );
      }
    }
  }

  function renderTaskDetail() {
    const container = getSection(TASK_ID);

    if (!container) return;

    const rows = openTask ? toTaskRows(openTask) : [];

    if (!rows.length) {
      openTask = "";
      container.hidden = true;
      taskDetail?.clear();
      markOpenPlot();
      return;
    }

    const returning = container.hidden;

    container.hidden = false;

    const detail = ensureTaskDetail();

    if (!detail.set(rows) && returning) {
      detail.refresh();
    }

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

    if (!tasks.length) {
      renderHtml(section, buildEmptyMessage(nothingScored));
      return;
    }

    const mode = scoreMode();

    if (view === PLOT_VIEW) {
      const plots = createModelPlots({
        entries: compared,
        tasks,
        mode,
      });

      section.replaceChildren(plots.element);
      breakdownCharts = plots.charts;
      return;
    }

    const { element, table } = createCompareTable({
      rows: toCompareRows(compared, tasks, mode),
      tasks,
      mode: "score",
    });

    section.replaceChildren(element);
    breakdownCharts = [table];
  }

  function renderDifferences() {
    const section = getSectionBody(DIFFERENCE);

    disposeAll(differenceCharts);
    differenceCharts = [];

    if (!tasks.length) {
      renderHtml(section, buildEmptyMessage(nothingScored));
      return;
    }

    if (compared.length < 2) {
      renderHtml(
        section,
        buildInfoMessage(`Select a second ${noun} to see the difference.`),
      );
      return;
    }

    const mode = diffMode(compared, getBaseline());

    if (view === PLOT_VIEW) {
      const plots = createModelPlots({
        entries: compared,
        tasks,
        mode,
        scale: "all",
      });

      section.replaceChildren(plots.element);
      differenceCharts = plots.charts;
      return;
    }

    const { element, table } = createCompareTable({
      rows: toCompareRows(compared, tasks, mode),
      tasks,
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

    const suites = availableSuites(comparison.entries(), scoresOf);

    renderHtml(
      select,
      buildOptions(
        suites.map((suite) => ({
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
        compared.map((entry) => ({
          value: entry.recordId,
          label: entry.recordName,
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
        comparison.entries(),
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

    compared = [];
    tasks = [];

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
      const plot = event.target?.closest?.("[data-group]");

      if (!plot) return;

      openTask =
        plot.dataset.group === openTask
          ? ""
          : plot.dataset.group;

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

      cacheKey: (entry) => entry.recordId,

      render: renderSections,
      clearUp,

      ...options,
    });

    return comparison;
  }

  return setup();
}

export { createRecordComparison };

