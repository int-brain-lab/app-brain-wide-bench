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
// The comparison is two panels beside each other:
//
//   Breakdown   scores for every task, or their distance from a baseline once one is chosen
//   Details     one column per record, ending in the methodology of the selected task
//
// Breakdown can be shown as plots or a table, and the task last picked out of it is read
// closely beside them once the scores breakdown is open.
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
import { resolveContainer } from "../core/dom.js";
import {
  getElement,
  refreshIcons,
  renderHtml,
  setText,
} from "../core/render.js";
import { metricLabel, suiteFromTask, taskLabel } from "../core/suites.js";
import { TASK_FIELDS } from "../schemas/taskSubmissionSchema.js";
import { withRanges } from "../plots/series.js";
import { createTaskPlot } from "../plots/recordPlots.js";
import { buildMetricBadge, buildTaskBadge } from "../components/badges.js";
import { SCORE_RANGE } from "../plots/taskScorePlots.js";
import { SERIES_COLOURS } from "../plots/palette.js";
import { buildDiff, buildMeanSem } from "../tables/formatters.js";
import {
  TABLE_VIEW,
  PLOT_VIEW,
  buildButton,
  buildPlotTableToggle,
  setButtonLabel,
} from "../components/buttons.js";
import { getIcon } from "../components/icons.js";
import {
  buildComparisonGrid,
  buildPicks,
  dropFromClick,
} from "../components/comparisonGrid.js";
import {
  methodologyCells,
  methodologyColumns,
} from "../components/methodologyGrid.js";
import { buildOptions, buildSelect } from "../components/filters.js";
import { buildEmptyMessage, buildInfoMessage } from "../components/messages.js";
import {
  buildSections,
  getSection,
  getSectionBody,
} from "../components/sections.js";
import { createComparison } from "./comparison.js";
import {
  buildRecordingsToggle,
  createTaskComparison,
} from "./taskScoreComparison.js";


// ─── CONFIGURATION ───────────────────────────────────────────────────────────

const DETAILS = "summary";
const BREAKDOWN = "breakdown";


const PICKS_ID = "compare-picks";

// The grid the details are drawn into, which is the picks' sibling rather than the section
// body: both are written by different renders and neither may replace the other.
const DETAILS_GRID_ID = "compare-details-grid";

// The grid is on a wrapper rather than on the section body, whose own `display` is set by
// the row it sits in — see `.section-row > .page-section > .section-body`.
const LAYOUT_ID = "compare-plot-layout";

const PLOTS_ID = "compare-plots";

// The cell the task being read fills: its name, and the mean of it in the chosen metric —
// drawn by the task panel, which holds the scores and the choice of metric with them.
const PLOT_CELL_ID = "compare-plot-cell";
const MEANS_ID = "compare-means";
const TASK_DETAIL_ID = "compare-task-detail";

const SCORES_ID = "compare-scores-toggle";

// The line over the plots saying what they are showing — see renderBreakdownHint. Not
// "compare-hint": the leaderboard's own hint carries that, and this widget is mounted on it.
const HINT_ID = "compare-breakdown-hint";

// The baseline select and the line above it, under the details grid. Hidden as one while a
// single task is being read: a difference is the set's question, not one task's.
const BASELINE_ROW_ID = "compare-baseline-row";

// The two view controls, one per state: every task drawn as plots or a table, or the one being
// read drawn as bars or a heatmap.
const TASK_VIEW_ID = "compare-task-view";
const SCORE_VIEW_ID = "compare-score-view";

const SHOW_SCORES = "See scores breakdown";
const HIDE_SCORES = "See every task";


// ─── DETAILS ─────────────────────────────────────────────────────────────────

/**
 * What each record is, and how it produced the score on one task.
 *
 * @param scoreFor (key) => that record's score on the task the methodology is read from, or
 *                 null. Omit for a grid of the preset's own attributes alone.
 */
function buildDetails(picks, details, colourFor, scoreFor = null) {
  const methodology = scoreFor ? methodologyColumns(TASK_FIELDS) : [];

  return buildComparisonGrid({
    layout: "columns",

    // `trailing` reads under the methodology — a preset's own attributes that belong below
    // the task's rather than above them.
    attributes: [
      ...details.attributes(),
      ...methodology,
      ...(details.trailing?.() ?? []),
    ],
    entities: picks.map((pick) => ({
      label: pick.name,
      ink: colourFor(pick.key),
      cells: {
        ...details.cells(pick),
        ...(scoreFor
          ? methodologyCells({
              record: scoreFor(pick.key),
              fields: TASK_FIELDS,
            })
          : {}),
      },
    })),
  });
}


// ─── RECORDS ─────────────────────────────────────────────────────────────────

// One record — a model, a submission — reduced to its scores.
//
// The key and the name come off the picked row, so neither waits on a request.
//
// `scores` is `{ task_id: { mean, sem, metric } }`, whichever endpoint answered it — a
// leaderboard row's `scores` and a breakdown's `tasks` both. Anything else it carries rides
// along unread.
function toRecord(pick, scores) {
  return {
    key: pick.key,
    name: pick.name,
    // { "ts1-choice": { mean, sem, metric }, … }
    tasks: scores ?? {},
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
// What a cell means: one reads a record's score on a task, the other how far it is from the
// baseline's. Which is in force is the baseline select's answer. The grid and the plot of one
// comparison share a mode.
//
// A mode is `{ valueOf, yAxisLabelOf, skip, yRange | yRangeKeyOf }`:
//
//   valueOf(record, taskId)  the cell, as `{ mean, sem }`, or null for nothing to show
//   yAxisLabelOf(metric)     what the y axis of that metric's plot is called
//   skip                     a record key to leave out of the columns and the series
//   yRange                   the span every plot is drawn against, where the mode fixes one
//   yRangeKeyOf(task)        which plots share a span the data decides — see withRanges in
//                            plots/series.js. For a mode with no `yRange`

function scoreMode() {
  return {
    valueOf: (record, taskId) => record.tasks[taskId] ?? null,
    yAxisLabelOf: metricLabel,
    skip: null,
    yRange: SCORE_RANGE,
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
    yAxisLabelOf: (metric) => `Δ ${metricLabel(metric)}`,
    skip: baselineId,
    // Differences are distances from one baseline, so every plot shares one range.
    yRangeKeyOf: () => "all",
  };
}

// ─── SCORES ──────────────────────────────────────────────────────────────────


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

// No label: the placeholder says what choosing one does, and says nothing once one is
// chosen — see renderBaselineOptions.
function buildBaselineSelect() {
  return `
    <span id="baseline" class="inline-select baseline-select">
      ${buildSelect({ name: "baseline", hook: "role", options: [] })}
    </span>`;
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
 * @param fixedKeys   picks that cannot be taken out — the record a host opened on. Their
 *                    chips are drawn without a ✕.
 * @param picksContainer where the chips naming what is compared are drawn, for a host with a
 *                    row of its own to put them in. Omit for the details panel's own.
 * @param options     as createComparison.
 * @returns the comparison — see createComparison.
 */
function createRecordComparison({
  container,
  noun = "record",
  max,
  details,
  readScores,
  fixedKeys = [],
  picksContainer = null,
  ...options
}) {
  // Picks that cannot be taken out: their chips are drawn without a ✕.
  const fixed = new Set(fixedKeys);

  const nothingScored = `None of these ${noun}s has a scored task yet.`;
  const emptyPrompt = `Select up to ${max} ${noun}s to compare them.`;

  // ─── STATE ─────────────────────────────────────────────────────────────────

  let comparison = null;

  let selectedView = PLOT_VIEW;
  let selectedBaseline = "";


  let selectedRecords = [];
  let taskSuiteGroups = [];

  let breakdownCharts = [];

  let selectedTask = "";
  let taskDetail = null;

  // One task read closely — its own plot, and the recordings behind it — rather than every
  // task at a glance.
  let showScores = false;


  // ─── STATE HELPERS ─────────────────────────────────────────────────────────


  // Empty for the scores themselves. A baseline that has since been dropped is empty too.
  function getBaseline() {
    return selectedRecords.some((record) => record.key === selectedBaseline)
      ? selectedBaseline
      : "";
  }


  function updateScores() {
    const scored = comparison
      .picks()
      .map((pick) => ({ pick, scores: readScores(pick) }))
      .filter(({ scores }) => scores != null);

    selectedRecords = scored.map(({ pick, scores }) => ({
      ...toRecord(pick, scores),
      colour: comparison.colourFor(pick.key),
    }));


    taskSuiteGroups = toTaskSuiteGroups(scoredTasksIn(selectedRecords));

    // The first, so the details grid opens on a task rather than on five dashes. Only where
    // the reader has not chosen one, and only where it is still scored.
    if (!allTasks().some((task) => task.taskId === selectedTask)) {
      selectedTask = allTasks()[0]?.taskId ?? "";
    }
  }

  // The tasks flat, in the order the groups hold them — what the grids bind their columns to.
  function allTasks() {
    return taskSuiteGroups.flatMap((group) => group.tasks);
  }


  // Both of them at once, each hidden while there is nothing to compare.
  function updateSections() {
    for (const id of [BREAKDOWN, DETAILS]) {
      const section = getSection(id);

      if (section) section.hidden = !heldCount();
    }
  }


  // ─── PICKS ─────────────────────────────────────────────────────────────────

  function heldCount() {
    return comparison?.picks().length ?? 0;
  }


  function getPicksRoot() {
    return picksContainer
      ? resolveContainer(picksContainer)
      : getElement(PICKS_ID);
  }

  function renderPicks() {
    const held = comparison
      ? comparison.picks().map((pick) => ({
          key: pick.key,
          label: pick.name,
          ink: comparison.colourFor(pick.key),
          fixed: fixed.has(pick.key),
        }))
      : [];

    renderHtml(getPicksRoot(), buildPicks(held), { refresh: true });
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
      container: getElement(TASK_DETAIL_ID),
      showPicks: false,
      nested: true,

      // The task being read is drawn here rather than in the panel: its mean in the chosen
      // metric, under the name of the task itself, and the choice of metric inside that card.
      meansContainer: MEANS_ID,
    });

    return taskDetail;
  }

  function markOpenPlot() {
    const body = getSectionBody(BREAKDOWN);

    for (const plot of body?.querySelectorAll("[data-plot]") ?? []) {
      plot.classList.toggle("selected", plot.dataset.plot === selectedTask);
    }
  }

  function renderTaskDetail() {
    const panel = getElement(TASK_DETAIL_ID);

    if (!panel) return;

    const picks = selectedTask ? toTaskPicks(selectedTask) : [];

    if (!picks.length) {
      selectedTask = "";
      panel.hidden = true;
      taskDetail?.clear();
      markOpenPlot();

      return;
    }

    panel.hidden = !showScores;

    if (showScores) ensureTaskDetail().setPicks(picks);

    markOpenPlot();
  }

  function renderScoresToggle() {
    setButtonLabel(getElement(SCORES_ID), {
      label: showScores ? HIDE_SCORES : SHOW_SCORES,
      icon: getIcon(showScores ? "collapse" : "expand"),
    });

    refreshIcons();
  }

  function closeTaskDetail() {
    selectedTask = "";
    renderTaskDetail();
  }


  // ─── SCORE PANELS ──────────────────────────────────────────────────────────

  function clearCharts() {
    disposeAll(breakdownCharts);

    breakdownCharts = [];
  }

  // What the rows are read for, over the column of names.
  function buildTaskCorner(task) {
    return buildTaskBadge(
      taskLabel(task.taskId),
      suiteFromTask(task.taskId) ?? "",
      "sm",
    );
  }

  // A table per task, laid out where the plots are: the task heads the names, the metric heads
  // the numbers, and the table is the whole of it.
  function buildTaskTables(mode, baseline) {
    const shown = selectedRecords.filter((record) => record.key !== mode.skip);

    const element = document.createElement("div");

    element.className = "grid-3 gap-lg";

    for (const task of allTasks()) {
      const cell = document.createElement("div");

      cell.dataset.plot = task.taskId;

      renderHtml(
        cell,
        buildComparisonGrid({
          layout: "rows",
          className: "task-scores",
          corner: buildMetricBadge(
                mode.yAxisLabelOf(task.metric || "score"),
                "sm",
              ),
          attributes: [
            {
              key: task.taskId,
              html: buildTaskCorner(task),
            },
          ],
          entities: shown.map((record) => {
            const value = mode.valueOf(record, task.taskId);

            return {
              label: record.name,
              ink: record.colour,
              cells: {
                [task.taskId]: {
                  html: baseline
                    ? buildDiff(value?.mean ?? null)
                    : buildMeanSem(value?.mean ?? null, value?.sem ?? null),
                },
              },
            };
          }),
        }),
      );

      element.appendChild(cell);
    }

    return element;
  }

  // A plot per task, grouped by suite. The breakdown draws them all against the mode's own
  // span; the differences have no such span, so those are taken across the tasks first and
  // shared by whichever of them the mode groups together.
  function buildTaskPlots(mode) {
    const shown = selectedRecords.filter((record) => record.key !== mode.skip);
    const names = new Map(shown.map((record) => [record.key, record.name]));
    const categories = shown.map((record) => record.key);

    const tasks = allTasks().map((task) => ({
      id: task.taskId,
      yRangeKey: mode.yRangeKeyOf?.(task),
      series: [toTaskSeries(shown, task, mode)],
    }));

    const plots = mode.yRange
      ? tasks.map((task) => ({ ...task, yRange: mode.yRange }))
      : withRanges(tasks);

    const element = document.createElement("div");
    const charts = [];

    element.className = "grid-3 gap-lg";

    for (const plot of plots) {
      const built = createTaskPlot({
        series: plot.series[0],
        categories,
        categoryLabel: (key) => names.get(key),
        yRange: plot.yRange,
        task: plot.id,
        height: 120,
      });

      built.element.dataset.plot = plot.id;

      charts.push(built.chart);
      element.appendChild(built.element);
    }

    return { element, charts };
  }

  // What the cards below are of: every task at a glance, the same tasks as distances from one
  // record, or the one task being read closely.
  function renderBreakdownHint() {
    const baseline = getBaseline();

    const against = selectedRecords.find(
      (record) => record.key === baseline,
    )?.name;

    setText(
      getElement(HINT_ID),
      showScores
        ? `One task read closely: its mean on the left, and the recordings behind it beside.`
        : baseline
          ? `Every task as the difference from ${against}.`
          : `Every task, each ${noun}'s score drawn against the same 0 to 1 span.`,
    );
  }

  // The scores, or how far each is from the baseline where one is chosen.
  function renderBreakdown() {
    const section = getElement(PLOTS_ID);
    const baseline = getBaseline();

    // Reading one task: a column for its plot and the rest for the recordings beside it —
    // see `.scores-rest`.
    getElement(LAYOUT_ID).className = showScores ? "grid-3 gap-lg" : "";
    getElement(TASK_DETAIL_ID).className = showScores ? "scores-rest" : "";

    // Reading one task, the mean of it stands in for its card in the grid.
    getElement(PLOTS_ID).hidden = showScores;

    getElement(MEANS_ID).hidden = !showScores;

    // One task is read as it stands: against the others is the set's question, and the table
    // is the set's other half.
    getElement(BASELINE_ROW_ID).hidden = showScores;
    getElement(TASK_VIEW_ID).hidden = showScores;
    getElement(SCORE_VIEW_ID).hidden = !showScores;

    renderBreakdownHint();

    disposeAll(breakdownCharts);
    breakdownCharts = [];

    if (!taskSuiteGroups.length) {
      renderHtml(section, buildEmptyMessage(nothingScored));
      return;
    }

    if (baseline && selectedRecords.length < 2) {
      renderHtml(
        section,
        buildInfoMessage(`Select a second ${noun} to see the difference.`),
      );
      return;
    }

    // Reading one task, the cell holds its mean rather than a card from the grid.
    if (showScores) {
      section.replaceChildren();

      return;
    }

    const mode = baseline ? diffMode(selectedRecords, baseline) : scoreMode();

    if (selectedView === PLOT_VIEW) {
      const { element, charts } = buildTaskPlots(mode);

      breakdownCharts = charts;
      section.replaceChildren(element);

      return;
    }

    section.replaceChildren(buildTaskTables(mode, baseline));
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
        {
          selected: getBaseline(),
          placeholder: `Select a baseline ${noun} to see differences`,
        },
      ),
    );
  }


  // ─── VIEW ──────────────────────────────────────────────────────────────────

  function viewButton(mode) {
    return getElement(`${mode}-${BREAKDOWN}`);
  }

  function setActiveView() {
    for (const mode of [PLOT_VIEW, TABLE_VIEW]) {
      viewButton(mode)?.classList.toggle("primary-inv", mode === selectedView);
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
    renderDetails();
    renderBreakdown();
    renderTaskDetail();
  }

  function renderDetails() {
    const scores = new Map(
      selectedRecords.map((record) => [record.key, record.tasks[selectedTask]]),
    );

    renderHtml(
      getElement(DETAILS_GRID_ID),
      buildDetails(
        comparison.picks(),
        details,
        comparison.colourFor,
        selectedTask ? (key) => scores.get(key) ?? null : null,
      ),
    );
  }

  function renderSections(held) {
    if (!held.length) {
      // Shown against the stack, which hides a section with nothing in it: the prompt is what
      // this section has to say while there is nothing to compare.
      getSection(DETAILS).hidden = false;

      renderHtml(getElement(DETAILS_GRID_ID), buildEmptyMessage(emptyPrompt));
      refreshIcons();

      return;
    }

    clearCharts();
    updateScores();

    renderPicks();
    setActiveView();
    renderBaselineOptions();

    updateSections();
    renderPanel();

    refreshIcons();
  }

  function teardown() {
    clearCharts();

    selectedRecords = [];
    taskSuiteGroups = [];

    if (!heldCount()) {
      closeTaskDetail();
      renderPicks();
    }

    updateSections();
  }


  // ─── EVENTS ────────────────────────────────────────────────────────────────

  function attachEvents() {
    attachViewEvents();
    attachPickEvents();
    attachScoresEvents();
    attachPlotEvents();
    attachSelectEvents();
  }

  function attachViewEvents() {
    for (const mode of [PLOT_VIEW, TABLE_VIEW]) {
      viewButton(mode)?.addEventListener("click", () => {
        renderView(mode);
      });
    }
  }

  function attachScoresEvents() {
    getElement(SCORES_ID)?.addEventListener("click", () => {
      showScores = !showScores;

      renderScoresToggle();
      renderBreakdown();
      renderTaskDetail();
    });
  }

  function attachPickEvents() {
    getPicksRoot()?.addEventListener("click", (event) => {
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

      // Set rather than toggled: the details grid reads its methodology off this task, and
      // a second click on the lit plot would leave those rows with nothing to show.
      selectedTask = plot.dataset.plot;

      // The details grid reads its methodology off the same task.
      renderDetails();
      renderTaskDetail();
    }

    getSectionBody(BREAKDOWN)?.addEventListener("click", handlePlotClick);
  }

  function attachSelectEvents() {
    getElement("baseline").addEventListener("change", (event) => {
      selectedBaseline = event.target.value;

      renderBreakdown();
    });
  }


  // ─── SETUP ─────────────────────────────────────────────────────────────────

  function setup() {
    const pageHtml = `
      <div class="section-row">
        ${buildSections([
          {
            id: BREAKDOWN,

            // No heading: what the plots are showing sits where one would be.
            controls: `<span class="metadata bold action-hint" id="${HINT_ID}"></span>`,
            actions: [
              `<span id="${TASK_VIEW_ID}">${buildPlotTableToggle(BREAKDOWN)}</span>`,
              `<span id="${SCORE_VIEW_ID}" hidden>${buildRecordingsToggle()}</span>`,
            ],
            className: "chart-pickable",
            collapsible: true,
            hidden: true,
          },
        ])}

        <div class="column gap-lg">
          ${buildSections([
            {
              id: DETAILS,
              collapsible: true,
              hidden: true,
            },
          ])}
        </div>
      </div>

    `;

    renderHtml(container, pageHtml);

    // The plots, and beside them the recordings behind whichever task is being read. Written
    // once: the panel is rebuilt on every change and neither may take the other with it.
    renderHtml(
      getSectionBody(BREAKDOWN),
      `
        <div id="${LAYOUT_ID}">
          <div id="${PLOT_CELL_ID}" class="column gap-lg">
            <div id="${PLOTS_ID}"></div>
            <div id="${MEANS_ID}"></div>
          </div>
          <div id="${TASK_DETAIL_ID}" hidden></div>
        </div>
      `,
    );

    // The grid, and under it the chips naming what is in it.
    renderHtml(
      getSectionBody(DETAILS),
      `
        <div id="${DETAILS_GRID_ID}"></div>

        <div id="${BASELINE_ROW_ID}" class="column gap-sm push-down">
          <span class="metadata bold action-hint">
            Select a baseline ${noun} to read every score as its distance from that one.
          </span>
          ${buildBaselineSelect()}
        </div>

        <div class="column gap-sm push-down">
          <span class="metadata bold action-hint">
            Read one task closely instead: the recordings behind it, and the metrics it can
            be read in.
          </span>

          <span class="row left gap-sm">
            ${buildButton({
              id: SCORES_ID,
              label: SHOW_SCORES,
              icon: getIcon("expand"),
              className: "sm muted",
            })}
          </span>
        </div>
        ${
          picksContainer
            ? ""
            : `<span class="row left gap-sm compare-picks" id="${PICKS_ID}"></span>`
        }
      `,
    );

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

