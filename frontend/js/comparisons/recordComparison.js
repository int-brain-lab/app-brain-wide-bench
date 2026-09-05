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
//
// Three rules the scores obey throughout:
//
//   1. A task's score is the *latest* submitted for it, never the best, and latest per task
//      — the same collapse app/ranking/rank.py does before ranking, which is what lets a rank
//      sit beside a score. Already done by the time `readScores` answers: a leaderboard row
//      and a model breakdown both arrive collapsed, by the server that ranks them.
//   2. A missing score is `null`, not `0`, so an unattempted suite doesn't drag a mean down.
//   3. The task columns are the *union* across the records compared, not any one record's
//      own. A comparator scoring something it never attempted shows as "—" in its column.

import { disposeAll } from "../core/disposable.js";
import { escapeHtml } from "../core/html.js";
import { getElement, refreshIcons, renderHtml } from "../core/render.js";
import {
  SUITES,
  suiteFromTask,
  suiteLabel,
  taskTypeOf,
} from "../core/suites.js";
import { withRanges } from "../plots/series.js";
import { createTaskPlot } from "../plots/recordPlots.js";
import { SERIES_COLOURS } from "../plots/palette.js";
import { createCompareTable } from "../tables/compareTable.js";
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
import { buildOptions, buildSelect } from "../components/filters.js";
import { buildEmptyMessage, buildInfoMessage } from "../components/messages.js";
import {
  buildSections,
  getSection,
  getSectionBody,
} from "../components/sections.js";
import { createTabDock } from "../components/tabDock.js";
import { createComparison } from "./comparison.js";
import { createTaskComparison } from "./taskScoreComparison.js";


// ─── CONFIGURATION ───────────────────────────────────────────────────────────

const DETAILS = "summary";
const BREAKDOWN = "breakdown";
const DIFFERENCE = "differences";


const PICKS_ID = "compare-picks";
const TASK_ID = "compare-task";

// The breakdown leads, which makes it the dock's anchor — it cannot be sent below the others.
const TABS = [
  { value: BREAKDOWN, label: "Breakdown" },
  { value: DIFFERENCE, label: "Difference" },
  { value: DETAILS, label: "Details" },
];


// ─── DETAILS ─────────────────────────────────────────────────────────────────

function buildDetails(picks, details, colourFor) {
  return buildComparisonGrid({
    layout: "columns",
    attributes: details.attributes(),
    entities: picks.map((pick) => ({
      label: pick.name,
      ink: colourFor(pick.key),
      cells: details.cells(pick),
    })),
  });
}


// ─── RECORDS ─────────────────────────────────────────────────────────────────

// One record — a model, a submission — reduced to its scores.
//
// The key and the name come off the picked row, so neither waits on a request; the team off
// the fetched detail, which every response backing a comparison carries.
//
// `scores` is `{ task_id: { mean, sem, metric } }`, whichever endpoint answered it — a
// leaderboard row's `scores` and a breakdown's `tasks` both. Anything else it carries rides
// along unread.
//
// `suite` narrows them to one; omit it for every task the record has scored.
function toRecord(pick, scores, suite = "") {
  const tasks = Object.fromEntries(
    Object.entries(scores ?? {}).filter(
      ([taskId]) => !suite || suiteFromTask(taskId) === suite,
    ),
  );

  return {
    key: pick.key,
    name: pick.name,
    teamName: pick.detail?.team_name ?? null,
    // { "ts1-choice": { mean, sem, metric }, … }
    tasks,
  };
}

/**
 * The union of scored tasks across `records`, sorted by id, each with the metric it is
 * measured in.
 *
 * The metric comes from whichever record scored the task first — it is a property of the
 * task, not of the model, so any of them answers the same. Taken from the scores rather
 * than GET /api/tasks so the panel needs no second source of truth for what it is already
 * displaying.
 */
function scoredTasksIn(records) {
  const metrics = new Map();

  for (const record of records) {
    for (const [taskId, task] of Object.entries(record.tasks)) {
      if (!metrics.has(taskId)) metrics.set(taskId, task.metric);
    }
  }

  return [...metrics]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([taskId, metric]) => ({ taskId, metric }));
}

// ─── MODES ───────────────────────────────────────────────────────────────────
//
// What a cell means, which is all that separates the breakdown from the differences: one
// reads a record's score on a task, the other how far it is from the baseline's. The grid and
// the plot of one comparison share a mode.
//
// A mode is `{ valueOf, yAxisLabelOf, skip, yRangeKeyOf }`:
//
//   valueOf(record, taskId)  the cell, as `{ mean, sem }`, or null for nothing to show
//   yAxisLabelOf(metric)     what the y axis of that metric's plot is called
//   skip                     a record key to leave out of the columns and the series
//   yRangeKeyOf(task)        which plots share a y range — see withRanges in plots/series.js

function scoreMode() {
  return {
    valueOf: (record, taskId) => record.tasks[taskId] ?? null,
    yAxisLabelOf: (metric) => metric,
    skip: null,
    yRangeKeyOf: (task) => `${taskTypeOf(task.taskId)}|${task.metric}`,
  };
}

/**
 * @param baselineId whichever record the reader is measuring against, which is the page's own
 *                   by default but may be any of the compared ones — "how much better is
 *                   everything than mine?" and "how much better is mine than this one?" are
 *                   the same comparison read two ways. It gets no column and no series of
 *                   its own: it would be a row of zeros.
 */
function diffMode(records, baselineId) {
  const baseline = records.find((record) => record.key === baselineId);

  return {
    // A task only one of the two scored has no difference to state, so the cell is empty.
    //
    // No sem: the two were scored on the same recordings, so √(s₁² + s₂²) does not hold.
    valueOf: (record, taskId) => {
      const other = record.tasks[taskId];
      const against = baseline?.tasks[taskId];

      return other && against
        ? { mean: other.mean - against.mean, sem: null }
        : null;
    },
    yAxisLabelOf: (metric) => `Δ ${metric}`,
    skip: baselineId,
    // Differences are distances from one baseline, so every plot shares one range.
    yRangeKeyOf: () => "all",
  };
}

// ─── ROWS ────────────────────────────────────────────────────────────────────

// One row per record, in the order given — pick order, never ranked.
//
// Tabulator binds a column to a field name, so each task id becomes a field, holding the whole
// { mean, sem } for the cell to render and the sorter to read `.mean` off.
function toCompareRows(records, scoredTasks, { valueOf, skip = null }) {
  return records
    .filter((record) => record.key !== skip)
    .map((record) => ({
      key: record.key,
      name: record.name,
      teamName: record.teamName,
      isReference: record.isReference,
      colour: record.colour,
      ...Object.fromEntries(
        scoredTasks.map(({ taskId }) => [taskId, valueOf(record, taskId)]),
      ),
    }));
}

// ─── SCORES ──────────────────────────────────────────────────────────────────

const PLOT_HEIGHT = 250;

// One task's scores as a plot series: a category per record, so a bar each.
function toTaskSeries(records, task, { valueOf, yAxisLabelOf }) {
  const values = records.map((record) => valueOf(record, task.taskId));

  return {
    label: null,
    colours: records.map((record) => record.colour),
    metric: yAxisLabelOf(task.metric || "score"),
    index: new Map(records.map((record, at) => [record.key, at])),
    values: {
      mean: values.map((value) => value?.mean ?? null),
      sem: values.map((value) => value?.sem ?? null),
    },
  };
}

// Grouped by suite, so a suite's plots sit together.
function toTaskSuiteGroups(tasks) {
  const groups = new Map();

  for (const task of tasks) {
    const key = suiteFromTask(task.taskId) ?? "";

    if (!groups.has(key)) groups.set(key, { key, tasks: [] });

    groups.get(key).tasks.push(task);
  }

  return [...groups.values()];
}

// The suites the picks have a score on, in SUITES order.
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
 * A comparison of records of one kind, drawn into `container`.
 *
 * @param container   element, or the id of one. Its contents are replaced.
 * @param noun        *singular*, for the prompts and the baseline select — "model".
 * @param max         how many can be compared at once.
 * @param details     { attributes, cells } the details panel is built from — see the presets
 *                    in modelComparison.js and submissionComparison.js.
 * @param readScores  (pick) => `{ [taskId]: { mean, sem, metric, … } }`. Null while the
 *                    pick's scores have not arrived, which skips it; `{}` where it scored
 *                    none, which keeps it and draws dashes. Called once per pick per render.
 * @param showSuites  whether the breakdown offers a suite select. Omit where the host has
 *                    already scoped the page to one.
 * @param referenceId the record the others are read against, badged "This model". Omit where
 *                    the host has no such record — a leaderboard's picks are six models with
 *                    no one of them the reader's own.
 * @param options     as createComparison.
 * @returns the comparison — see createComparison.
 */
function createRecordComparison({
  container,
  noun = "record",
  max,
  details,
  readScores,
  showSuites = true,
  referenceId = "",
  ...options
}) {
  const nothingScored = `None of these ${noun}s has a scored task yet.`;
  const emptyPrompt = `Select up to ${max} ${noun}s to compare them.`;

  // ─── STATE ─────────────────────────────────────────────────────────────────

  let comparison = null;

  let selectedView = PLOT_VIEW;
  let selectedSuite = "";
  let selectedBaseline = "";


  let selectedRecords = [];
  let taskSuiteGroups = [];
  let availableSuites = [];

  let breakdownCharts = [];
  let differenceCharts = [];

  let selectedTask = "";
  let taskDetail = null;

  const dock = createTabDock({
    noun,
    tabs: TABS,
    container,
    hasContent: () => (comparison?.picks().length ?? 0) > 0,
    onChange: renderPanel,
  });


  // ─── STATE HELPERS ─────────────────────────────────────────────────────────


  function getBaseline() {
    return selectedRecords.some((record) => record.key === selectedBaseline)
      ? selectedBaseline
      : selectedRecords[0]?.key ?? "";
  }


  function updateScores() {
    const scored = comparison
      .picks()
      .map((pick) => ({ pick, scores: readScores(pick) }))
      .filter(({ scores }) => scores != null);

    availableSuites = availableSuitesIn(scored);
    const suite =
      showSuites && availableSuites.includes(selectedSuite) ? selectedSuite : "";

    selectedRecords = scored.map(({ pick, scores }) => ({
      ...toRecord(pick, scores, suite),
      isReference: Boolean(referenceId) && pick.key === referenceId,
      colour: comparison.colourFor(pick.key),
    }));


    taskSuiteGroups = toTaskSuiteGroups(scoredTasksIn(selectedRecords));
  }

  // The tasks flat, in the order the groups hold them — what the grids bind their columns to.
  function allTasks() {
    return taskSuiteGroups.flatMap((group) => group.tasks);
  }


  // ─── PICKS ─────────────────────────────────────────────────────────────────

  function heldCount() {
    return comparison?.picks().length ?? 0;
  }


  function renderPicks() {
    const held = comparison
      ? comparison.picks().map((pick) => ({
          key: pick.key,
          label: pick.name,
          ink: comparison.colourFor(pick.key),
        }))
      : [];

    renderHtml(getElement(PICKS_ID), buildPicks(held), { refresh: true });
  }


  // ─── TASK DETAIL ───────────────────────────────────────────────────────────

  function toTaskPicks(taskId) {
    return selectedRecords.flatMap((record) => {
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

      for (const plot of body?.querySelectorAll("[data-plot]") ?? []) {
        plot.classList.toggle(
          "selected",
          plot.dataset.plot === selectedTask,
        );
      }
    }
  }

  function renderTaskDetail() {
    const section = getSection(TASK_ID);

    if (!section) return;

    const picks = selectedTask ? toTaskPicks(selectedTask) : [];

    if (!picks.length) {
      selectedTask = "";
      section.hidden = true;
      taskDetail?.clear();
      markOpenPlot();

      return;
    }

    section.hidden = false;

    ensureTaskDetail().setPicks(picks);

    markOpenPlot();
  }

  function closeTaskDetail() {
    selectedTask = "";
    renderTaskDetail();
  }


  // ─── SCORE PANELS ──────────────────────────────────────────────────────────

  function clearCharts() {
    disposeAll(breakdownCharts);
    disposeAll(differenceCharts);

    breakdownCharts = [];
    differenceCharts = [];
  }

  // A plot per task, grouped by suite. The y ranges are taken across every task first, so
  // tasks measured the same way share a span whichever group they land in.
  function buildTaskPlots(mode) {
    const shown = selectedRecords.filter((record) => record.key !== mode.skip);
    const names = new Map(shown.map((record) => [record.key, record.name]));
    const categories = shown.map((record) => record.key);

    const plots = withRanges(
      taskSuiteGroups.flatMap((group) =>
        group.tasks.map((task) => ({
          id: task.taskId,
          yRangeKey: mode.yRangeKeyOf(task),
          series: [toTaskSeries(shown, task, mode)],
        })),
      ),
    );

    const element = document.createElement("div");
    const charts = [];

    element.className = "grid-8";

    for (const plot of plots) {
      const built = createTaskPlot({
        series: plot.series[0],
        categories,
        categoryLabel: (key) => names.get(key),
        yRange: plot.yRange,
        height: PLOT_HEIGHT,
      });

      built.element.dataset.plot = plot.id;

      charts.push(built.chart);
      element.appendChild(built.element);
    }

    return { element, charts };
  }

  function renderBreakdown() {
    const section = getSectionBody(BREAKDOWN);

    disposeAll(breakdownCharts);
    breakdownCharts = [];

    if (!taskSuiteGroups.length) {
      renderHtml(section, buildEmptyMessage(nothingScored));
      return;
    }

    const mode = scoreMode();

    if (selectedView === PLOT_VIEW) {
      const { element, charts } = buildTaskPlots(mode);

      breakdownCharts = charts;
      section.replaceChildren(element);

      return;
    }

    const { element, table } = createCompareTable({
      rows: toCompareRows(selectedRecords, allTasks(), mode),
      scoredTasks: allTasks(),
      mode: "score",
    });

    section.replaceChildren(element);
    breakdownCharts = [table];
  }

  function renderDifferences() {
    const section = getSectionBody(DIFFERENCE);

    disposeAll(differenceCharts);
    differenceCharts = [];

    if (!taskSuiteGroups.length) {
      renderHtml(section, buildEmptyMessage(nothingScored));
      return;
    }

    if (selectedRecords.length < 2) {
      renderHtml(
        section,
        buildInfoMessage(`Select a second ${noun} to see the difference.`),
      );
      return;
    }

    const mode = diffMode(selectedRecords, getBaseline());

    if (selectedView === PLOT_VIEW) {
      const { element, charts } = buildTaskPlots(mode);

      differenceCharts = charts;
      section.replaceChildren(element);

      return;
    }

    const { element, table } = createCompareTable({
      rows: toCompareRows(selectedRecords, allTasks(), mode),
      scoredTasks: allTasks(),
      mode: "diff",
    });

    section.replaceChildren(element);
    differenceCharts = [table];
  }


  // ─── SELECTS ───────────────────────────────────────────────────────────────

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
        selectedRecords.map((record) => ({
          value: record.key,
          label: record.name,
        })),
        { selected: getBaseline() },
      ),
    );
  }


  // ─── VIEW ──────────────────────────────────────────────────────────────────

  function viewButton(panel, mode) {
    return getElement(`${mode}-${panel}`);
  }

  function setActiveView() {
    for (const panel of [BREAKDOWN, DIFFERENCE]) {
      for (const mode of [PLOT_VIEW, TABLE_VIEW]) {
        viewButton(panel, mode)?.classList.toggle(
          "primary-inv",
          mode === selectedView,
        );
      }
    }
  }

  function renderView(nextView) {
    if (nextView === selectedView) return;

    selectedView = nextView;
    setActiveView();
    renderPanel();
  }


  // ─── RENDERING ─────────────────────────────────────────────────────────────

  function renderPanel() {
    if (selectedView !== PLOT_VIEW) {
      selectedTask = "";
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
        comparison.colourFor,
      ),
    );
  }

  function renderSections(held) {
    if (!held.length) {
      renderHtml(getSectionBody(DETAILS), buildEmptyMessage(emptyPrompt));
      refreshIcons();

      return;
    }

    clearCharts();
    updateScores();

    renderPicks();
    setActiveView();

    if (showSuites) {
      renderSuiteOptions();
    }

    renderBaselineOptions();

    dock.render();
    renderPanel();

    refreshIcons();
  }

  function teardown() {
    clearCharts();

    selectedRecords = [];
    taskSuiteGroups = [];
    availableSuites = [];

    if (!heldCount()) {
      closeTaskDetail();
      renderPicks();
    }

    dock.render();
  }


  // ─── EVENTS ────────────────────────────────────────────────────────────────

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
      const plot = event.target?.closest?.("[data-plot]");

      if (!plot) return;

      selectedTask =
        plot.dataset.plot === selectedTask ? "" : plot.dataset.plot;

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


  // ─── SETUP ─────────────────────────────────────────────────────────────────

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
      max,
      palette: SERIES_COLOURS,

      render: renderSections,
      teardown,

      ...options,
    });

    // The empty prompt. After the assignment above, which `renderSections` reaches back
    // through.
    comparison.refresh();

    return comparison;
  }

  return setup();
}

export { createRecordComparison };

