// Several records side by side: what they are, and how they scored on one suite.
//
// A record is whatever the host is comparing — a model, a submission — and nothing here knows
// which. What differs between them is a small descriptor the caller brings: what a column of
// the details panel says, and where the scores behind a record come from. Everything else is
// the same reading either way, which is why there is one widget rather than one per noun. The
// presets are modelComparison.js and submissionComparison.js.
//
// Three panels, one at a time, behind a strip of tabs:
//
//   Details     one column per record, one row per attribute the host named
//   Breakdown   every task on the suite, as a plot or as a grid — records across the top
//   Difference  the same again, measured against a baseline the reader picks
//
// Under all three, the task whose plot the reader last clicked, in full. Either panel of plots
// opens one and marks which, and it stays open across the tabs — see renderTaskDetail.
//
// One at a time rather than stacked, because all three are readings of the same handful of
// records and only one is being read: stacked, the two score panels were a page-length scroll
// under the table that says which records they are about.
//
// Only the open panel is drawn, which is not just thrift — a plot built inside a hidden
// element has no width to size its canvas to.
//
// Above the tabs, a chip per record with an ✕: what is being compared belongs to all three
// panels, so it is named once over them rather than in whichever one is open.
//
// The picks and the fetches are comparison.js; this supplies its `render`.

import { escapeHtml } from "../core/html.js";
import {
  buildEmptyMessage,
  buildInfoMessage,
} from "../components/messages.js";
import { getElement, renderHtml} from "../core/render.js";
import {
  buildSections,
  getSection,
  getSectionBody,
} from "../components/sections.js";
import {
  TABLE_VIEW,
  PLOT_VIEW,
  buildPlotTableToggle
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
import { buildTabs, markTabs, tabFromEvent } from "../components/tabs.js";
import {disposeAll} from "../core/disposable.js";


// ─── CONFIGURATION ───────────────────────────────────────────────────────────

// A section is found by document id, so these are this widget's names and no one else's: the
// task comparison it opens underneath is on the same page, and calls its own two
// "methodology" and "recordings" for the same reason.
const DETAILS = "summary";
const BREAKDOWN = "breakdown";
const DIFFERENCE = "differences";

// The strip's name, and the panels in the order they read. A tab's value is the id of the
// section it opens, so there is one list behind both.
const PANELS = "compare-panel";

const TABS = [
  { value: DETAILS, label: "Details" },
  { value: BREAKDOWN, label: "Breakdown" },
  { value: DIFFERENCE, label: "Difference" },
];

// The task a reader has opened a plot onto, under all three panels rather than inside the one
// it was opened from: a task is a detail of the records being compared, not of the reading
// that happened to be on screen, so switching tabs leaves it where it was. Written once in setup,
// because it holds a widget with fetches of its own.
const TASK_ID = "compare-task";

// The records being compared, named above the tabs: they belong to all three panels rather
// than to any one of them, and this is the one place a reader takes one out from inside the
// widget.
const PICKS_ID = "compare-picks";


// ─── DETAILS ─────────────────────────────────────────────────────────────────

// Records across the top, one attribute per row. Turned, because a set of attributes runs
// long — a model's specification is nine fields, unreadable as a header and a plain list as a
// column — where six records is a width the page has.
//
// Which column is which record is its colour, matched to the chips above the tabs: the names
// are there, so a header repeating them under them would be the same list twice.
function buildDetails(entries, details, colourOf) {
  return buildComparisonGrid({
    layout: "columns",
    attributes: details.attributes(),
    entities: entries.map((entry) => ({
      ink: colourOf(entry.key),
      cells: details.cells(entry),
    })),
  });
}

// ─── SCORES ──────────────────────────────────────────────────────────────────

// What the two score sections are drawn from. The colour is carried on the record rather than
// taken from its place in the list, so a record keeps it when another is dropped — and so the
// grid's column, the bars and the row it was picked from all agree.
//
// `tasks` is derived from the records, and returned with them so that the bars and the rows
// share one axis — and because plots/ cannot reach up here to compute its own.
//
// A pick whose scores haven't arrived is left out rather than drawn as a column of dashes —
// it would read as a record that scored nothing. `selectedId` is still the first *pick*, so
// the badge lands on the right one once its own scores do.
function scoresForRecords(entries, scoresOf, suite, colourOf) {
  const scored = entries.filter((entry) => scoresOf(entry) != null);
  const compared = toCompareEntries(
    scored,
    scoresOf,
    suite,
    entries[0]?.recordId,
  ).map((entry) => ({ ...entry, colour: colourOf(entry.recordId) }));

  return { compared, tasks: compareTasks(compared) };
}

// The suites the selection has scores on, in SUITES order. From the scores rather than from
// whatever produced them, so the select can only offer a suite there is something to draw for
// — and so it offers the same ones whichever host supplied them.
function availableSuites(entries, scoresOf) {
  const scored = new Set(
    entries
      .flatMap((entry) => Object.keys(scoresOf(entry) ?? {}))
      .map(suiteFromTask)
      .filter(Boolean),
  );

  return SUITES.filter((suite) => scored.has(suite));
}

// The hook is "role" rather than the bar's "filter": a list page's own bar carries a suite
// control of the same name, and a delegated listener must never hear this one.
function buildBar(label, name, options, selected) {
  return `
    <span id=${name} class="row left gap-md">
      <span class="metadata">${escapeHtml(label)}</span>
      <span class="inline-select">
        ${buildSelect({ name, hook: "role", options, selected })}
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
 * @param container as createComparison.
 * @param noun      *singular* — what one of these is, for the prompt. "model", "submission".
 * @param max       how many can be compared at once. The palette is sized for six.
 * @param details   `{ attributes, cells }` for the details panel: `attributes()` is
 *                  [{ key, label }] in the order they read — a function, since a schema's
 *                  labels are filled in at load — and `cells(entry)` is the one column under
 *                  them, as `{ [key]: { value, html? } }`, the shape buildComparisonGrid
 *                  takes. An entry whose detail has not landed yet is still passed, and says
 *                  so with nulls.
 * @param toEntry   (row) => { key, recordId, name, teamName, taskSubmissionIds?, modelName?,
 *                  submissionLabel? }. `key` identifies the row in the host's view; `recordId`
 *                  is what gets fetched, and the ids — where the host has them — say which of
 *                  its entries to describe. The last two are how a score of this record is
 *                  named where a task is opened out; without them the record's own name is.
 * @param scoresOf  (entry) => `{ task_id: { mean, sem, metric, … } }`, or null while the
 *                  host has none yet. A host holding the scores already — a leaderboard
 *                  response has them collapsed, filtered and ranked — passes its own, so that
 *                  what the comparison shows and what the table above it shows are the same
 *                  numbers. Called on every render rather than read off the entry once: an
 *                  entry outlives the data behind it.
 * @param order     as createComparison.
 * @param rest      as createComparison — `loadDetail` and `cacheKey` in particular, which is
 *                  how a preset says where a record's own data comes from.
 *
 * A host that passes a suite to `set` owns it; one that passes nothing gets the suite bar
 * below instead.
 */
function createRecordComparison({
  container,
  noun = "record",
  max,
  details,
  scoresOf,
  ...options
}) {

  // Said by either score panel with nothing to draw. Not "on this suite": the comparison shows
  // every suite unless the reader has narrowed it, so the emptiness may be the records' rather
  // than the suite's.
  const nothingScored = `None of these ${noun}s has a scored task yet.`;

  // How both score sections are being read.
  let view = PLOT_VIEW;

  // Which panel is open, and the element holding the strip and the panels — the one the tab
  // presses are read off.
  let panel = DETAILS;
  let root = null;

  let comparison = null;

  // Per section, because the two are now redrawn separately.
  let breakdownCharts = [];
  let differenceCharts = [];

  let selectedBaseline = "";
  let selectedSuite = "";

  // The records being compared on the suite in force, and the tasks they cover. Held rather
  // than recomputed per section: only the picks and the suite move them, and both go through
  // updateScores.
  let compared = [];
  let tasks = [];

  // The task whose plot is open under the breakdown, and the widget drawing it. The task is
  // held rather than read off the DOM, so it survives the plots being redrawn — a record added
  // to the comparison adds a bar to the open plot and a column to the panel under it, rather
  // than closing what the reader was looking at.
  let openTask = "";
  let taskDetail = null;



  function clearCharts() {
    disposeAll(breakdownCharts);
    disposeAll(differenceCharts);

    breakdownCharts = [];
    differenceCharts = [];
  }

  // Before every render, the empty one included. With nothing picked the controller writes its
  // prompt into the details panel and never calls the render, so this is the only chance to
  // drop the plots that were drawn for the records that have just gone — and to hand the reader
  // back to the panel the prompt is in, since the other two now have nothing behind them.
  function clearUp() {
    clearCharts();

    compared = [];
    tasks = [];

    // With nothing picked there is no plot to have opened a task from, and no scores to draw
    // it with. Only then: this runs before every render, and a task has to survive a record
    // being added to the comparison it is a detail of.
    if (!canOpen(BREAKDOWN)) {
      closeTaskDetail();

      // The one render the controller does itself is the empty one, which never reaches
      // renderSections — so this is where the row is cleared.
      renderPicks();
    }

    showPanel();
  }

  // Whether a panel has anything behind it: the details always — with nothing picked it is
  // where the prompt goes — and the two score panels once something is picked.
  //
  // Off the selection rather than off `compared`, because it is asked before the scores
  // for this render have been worked out; and a pick whose scores have not landed is still a
  // panel worth opening, since its own message is what says so.
  function canOpen(value) {
    return value === DETAILS || (comparison?.entries() ?? []).length > 0;
  }

  // The open panel, and the strip that says which it is. The reader's choice stands unless it
  // has nothing behind it — dropping the last pick hands them back to the details rather than
  // leaving them on an empty panel.
  function showPanel() {
    if (!canOpen(panel)) panel = DETAILS;

    for (const { value } of TABS) {
      const section = getSection(value);

      if (section) section.hidden = value !== panel;
    }

    if (root) markTabs(root, PANELS, panel, canOpen);
  }

  // One row per compared record that has an entry for this task: the ids its host named for
  // it, which is what the task comparison fetches the recordings by. A record with no entry
  // for the task simply has no row — it has no score in the plot either.
  function toTaskRows(taskId) {
    return compared.flatMap((entry) => {
      const score = entry.tasks[taskId];

      if (!score?.task_submission_id || !score.submission_id) return [];

      return [
        {
          taskSubmissionId: score.task_submission_id,
          submissionId: score.submission_id,
          taskId,
          // How a score of this record is named where the task is opened out. The host's own
          // two where it has them — a submission knows both its model and its label — and the
          // record's name where it does not, which for a model is the model's.
          modelName: entry.modelName ?? entry.recordName,
          submissionLabel: entry.submissionLabel ?? null,
          metric: score.metric,
          // The record's own, so a score below is the colour of the bar above it — see inkOf
          // in taskScoreComparison.js.
          colour: entry.colour,
        },
      ];
    });
  }

  // Built on first use and kept: it holds what it has fetched per score, and reopening a task
  // is then a redraw rather than a round trip.
  function ensureTaskDetail() {
    if (taskDetail) return taskDetail;

    taskDetail = createTaskComparison({
      container: getElement(TASK_ID),

      // The means beside the methodology and the recordings under them: this sits under a
      // panel that is already a page deep, and a row each would put the recordings a page and
      // a half below the plot they were opened from.
      layout: "row",

      // No chips of its own: these picks are set from the records above, which are already
      // named in the same colours over the tabs — and a ✕ here would drop a score only until
      // renderTaskDetail set them again.
      picks: false,

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

  // The records being compared, in the colours they are drawn in. Rewritten on every render,
  // which is what keeps them in step with the panels below — and emptied by clearUp, so with
  // nothing picked the row collapses rather than naming records that have gone.
  function renderPicks() {
    const picks = comparison
      ? comparison.entries().map((entry) => ({
          key: entry.key,
          label: entry.name,
          ink: comparison.colourOf(entry.key),
        }))
      : [];

    renderHtml(getElement(PICKS_ID), buildPicks(picks), { refresh: true });
  }

  // Which plot is open, on the plots themselves — the reader has to be able to see which of
  // eleven the panel below is about. Both panels, since either draws a plot per task and the
  // one below them belongs to neither: the task stays marked in whichever is on screen.
  //
  // Scoped to the panel bodies and not the widget, because the task panel draws plots of its
  // own — of recordings, which carry a group like any other plot and are nobody's task.
  function markOpenPlot() {
    for (const id of [BREAKDOWN, DIFFERENCE]) {
      const plots = getSectionBody(id);

      for (const plot of plots?.querySelectorAll("[data-group]") ?? []) {
        plot.classList.toggle("selected", plot.dataset.group === openTask);
      }
    }
  }

  // The task under the panels, if one is open and there is still something to draw for it.
  //
  // Shown before it is filled, not after: the recording plots are canvases, and one built
  // inside a hidden element has no width to size itself to.
  function renderTaskDetail() {
    const container = getElement(TASK_ID);

    if (!container) return;

    const rows = openTask ? toTaskRows(openTask) : [];

    // Nothing left to open it onto — the task has gone from the suite, or every record that
    // scored it has been dropped.
    if (!rows.length) {
      openTask = "";

      container.hidden = true;
      taskDetail?.clear();
    } else {
      const returning = container.hidden;

      container.hidden = false;

      const detail = ensureTaskDetail();

      // `set` is a no-op when the same scores are already held, which is the common case on a
      // redraw of the panels above. Drawn outright only when the panel is coming back into
      // view, where a canvas sized while hidden has no size to come back at; otherwise there is
      // nothing new to draw and a redraw is a flicker for its own sake.
      if (!detail.set(rows) && returning) detail.refresh();
    }

    markOpenPlot();
  }

  function closeTaskDetail() {
    openTask = "";

    renderTaskDetail();
  }

  // Only the one on screen: a plot built inside a hidden element sizes its canvas to nothing,
  // and a panel is redrawn on the way in anyway.
  //
  // The task panel afterwards, whichever was drawn — including neither, on the details tab,
  // where it stays open under a grid that did not open it. It closes itself when there is
  // nothing left to draw for the open task, so the only rule here is the one about the view: a
  // plot is what opens a task, and a table has nothing to keep one open against.
  function renderPanel() {
    if (view !== PLOT_VIEW) openTask = "";

    if (panel === BREAKDOWN) renderBreakdown();
    else if (panel === DIFFERENCE) renderDifferences();

    renderTaskDetail();
  }


  // The suite in force, or "" for all of them — which is the default, and what the reader
  // gets back by choosing the blank option. A host that scopes the page to one suite wins
  // over both: see `set(rows, suite)` in pages/compare.js.
  function getSuite() {
    if (comparison.activeContext) return comparison.activeContext;

    return availableSuites(comparison.entries(), scoresOf).includes(selectedSuite)
      ? selectedSuite
      : "";
  }


  // The baseline in force, read the same way as the suite: the reader's while it is still
  // among the compared records, else the first of them. Derived rather than written back, so
  // `selectedBaseline` means what the reader chose and nothing else.
  function getBaseline() {
    return compared.some((entry) => entry.recordId === selectedBaseline)
      ? selectedBaseline
      : (compared[0]?.recordId ?? "");
  }

  // After anything that changes which records are compared or which suite they are compared
  // on: the picks, their details arriving, or the reader choosing a suite.
  function updateScores() {
    ({ compared, tasks } = scoresForRecords(
      comparison.entries(),
      scoresOf,
      getSuite(),
      comparison.colourOf,
    ));
  }

  // The blank first option is the default rather than an escape from a choice: a comparison
  // opens on every suite at once, and picking one narrows it.
  function buildSuiteOptions(availableSuites, selectedSuite) {
    const select = getElement("suite").querySelector(`[data-role='suite']`);
    const options = buildOptions(
      availableSuites.map((suite) => ({
        value: suite,
        label: suiteLabel(suite),
      })),
      { selected: selectedSuite, placeholder: "All suites" },
    );
    renderHtml(select, options);
  }

  // The compared records rather than the picks: a pick with nothing on this suite is not a
  // baseline getBaseline would ever return, so offering it would leave the select showing one
  // record and the differences measured against another.
  function buildBaselineOptions(compared, baseline) {
    const select = getElement("baseline").querySelector(`[data-role='baseline']`);
    const options = buildOptions(compared.map((entry) => ({
      value: entry.recordId,
      label: entry.recordName
    })), {selected: baseline});
    renderHtml(select, options);
  }


  // ─── RENDER ────────────────────────────────────────────────────────────────

  // What is in the panel, not whether it shows — that is showPanel's, and a panel with nothing
  // to draw says so in words rather than vanishing from under the tab that opened it. Nor
  // whether a task is open under it: that is renderPanel's, and the same for both panels.
  function renderBreakdown() {
    const section = getSectionBody(BREAKDOWN);

    disposeAll(breakdownCharts);
    breakdownCharts = [];

    if (!tasks.length) {
      renderHtml(section, buildEmptyMessage(nothingScored));

      return;
    }

    // One mode for both halves, so the plot and the grid cannot disagree about a cell.
    const mode = scoreMode();

    if (view === PLOT_VIEW) {
      const plots = createModelPlots({ entries: compared, tasks, mode });

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

    // The two reasons there is nothing to draw, which are different things to say: no scores
    // to difference, as against scores but only one record to measure.
    if (!tasks.length) {
      renderHtml(
        section,
        buildEmptyMessage(nothingScored),
      );

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
        // A difference is a distance from one baseline, so every plot shares one range.
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


  function renderSections() {
    clearCharts()

    // The picks or their details changed, which is the one thing the controller calls for.
    updateScores();

    renderPicks();

    renderHtml(
      getSectionBody(DETAILS),
      buildDetails(comparison.entries(), details, comparison.colourOf),
    );

    setActiveView(view);

    // Both selects, whichever panel is open: each heads a panel the reader can be one press
    // away from, so neither can wait for its own panel to be drawn.
    buildSuiteOptions(availableSuites(comparison.entries(), scoresOf), selectedSuite);
    buildBaselineOptions(compared, getBaseline());

    // The two score panels are openable now, which clearUp said they were not.
    showPanel();

    renderPanel();
  }


  function setActiveView(view) {
    for (const button of [
      getElement(PLOT_VIEW),
      getElement(TABLE_VIEW),
    ]) {
      button?.classList.toggle("primary-inv", button.id === view);
    }
  }


  function renderView(selectedView) {
    view = selectedView;
    setActiveView(view);

    renderPanel();
  }


  function attachEvents() {
    getElement(PLOT_VIEW)?.addEventListener("click", () => {
      renderView(PLOT_VIEW)
    });

    getElement(TABLE_VIEW)?.addEventListener("click", () => {
      renderView(TABLE_VIEW)
    });


    // Delegated on the element the strip and the panels share: the strip is written once, but
    // a listener per tab would be three where one reads the same.
    root.addEventListener("click", (event) => {
      const tab = tabFromEvent(event);

      if (!tab || tab.name !== PANELS || tab.value === panel) return;

      panel = tab.value;

      showPanel();

      // On the way in, not on the way out: a panel is drawn at the width it is about to be
      // read at, which a hidden one does not have.
      renderPanel();
    });

    // On the row rather than on each chip: the chips are rewritten on every render, and the
    // row they sit in is written once.
    getElement(PICKS_ID)?.addEventListener("click", (event) => {
      const key = dropFromClick(event);

      if (key) comparison.drop(key);
    });

    // Delegated on each panel's body, which is written once while the plots inside it are
    // replaced on every render. A plot carries the axis it is on — the task, here — see
    // arrangePlots. On the bodies rather than on the widget, for markOpenPlot's reason: the
    // task panel's own plots carry a group too, and it is a recording rather than a task.
    //
    // Pressing the open one closes it: the panel is a detail of the plot that opened it, so the
    // plot is also the way back out.
    function opened(event) {
      const plot = event.target?.closest?.("[data-group]");

      if (!plot) return;

      openTask = plot.dataset.group === openTask ? "" : plot.dataset.group;

      renderTaskDetail();
    }

    for (const id of [BREAKDOWN, DIFFERENCE]) {
      getSectionBody(id)?.addEventListener("click", opened);
    }

    getElement("suite").addEventListener("change", (event) => {
      selectedSuite = event.target.value;

      // A different suite is a different set of scored tasks, and a different set of records
      // with a score to show — so the baseline list is a different list too.
      updateScores();
      buildBaselineOptions(compared, getBaseline());

      renderPanel();
    });

    getElement("baseline").addEventListener("change", (event) => {
      selectedBaseline = event.target.value;

      renderDifferences();
    });
  }


  function setup() {

    // The two score panels keep a title of their own: it is the row their selects sit on, and
    // a section with actions and no title has nowhere to put them. All three start hidden —
    // the controller's first render calls clearUp, which opens the one with the prompt in it.
    const pageHtml = `
      <span class="row left gap-sm compare-picks" id="${PICKS_ID}"></span>
      ${buildTabs({ name: PANELS, tabs: TABS })}
      ${buildSections([
        {
          id: DETAILS,
          hidden: true,
        },
        // `chart-pickable` on both: a plot in either is a way into the task it draws, so both
        // draw them as controls and both are what a click is read off.
        {
          id: BREAKDOWN,
          title: "Task breakdown",
          actions: [buildSuiteSelect(), buildPlotTableToggle()],
          className: "chart-pickable",
          hidden: true,
        },
        {
          id: DIFFERENCE,
          title: "Differences",
          actions: [buildBaselineSelect(noun)],
          className: "chart-pickable",
          hidden: true,
        },
      ])}
      <div id="${TASK_ID}" hidden></div>`;

    root = renderHtml(container, pageHtml);

    attachEvents();

    comparison = createComparison({
      container: getSectionBody(DETAILS),
      max,
      prompt: `Select up to ${max} ${noun}s to compare them.`,
      palette: SERIES_COLOURS,

      // The record, not the row: two rows of a host's table can name one record — two
      // leaderboard rows can name one model.
      cacheKey: (entry) => entry.recordId,

      render: renderSections,
      clearUp,

      // Last, so a preset's `loadDetail`, `toEntry` and the rest stand.
      ...options,
    });

    return comparison;
  }

  // Eagerly, because a host binds its table to the comparison the moment it has one — see
  // bindTableSelection in pages/leaderboard.js.
  return setup();
}

export { createRecordComparison };

