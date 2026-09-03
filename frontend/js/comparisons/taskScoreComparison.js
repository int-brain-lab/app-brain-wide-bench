// Several task scores side by side: what each came to, how it was measured, and what it did
// per recording.
//
//   picks        a chip per score with an ✕, which is what names every column and series
//                below — all of those carry only the colour. Left out by a host that names
//                them already, and whose picks these are: see `picks`
//   means        a bar per score of its mean for one metric, with the spread of that mean.
//                One plot per *combination* of metrics, so the scores in a plot are the ones
//                measured the same way and its dropdown offers exactly what they share
//   methodology  a score per column, a training field per row
//   recordings   every recording behind those scores — a plot per score as points or as bars,
//                or a heatmap
//
// How the three sit depends on the width the host has: a row each where this has a page to
// itself, and the means beside the methodology with the recordings under them where it is a
// panel inside another comparison — see `layout`. Either way the bars come first: they are the
// figures, and what follows is where each of them came from.
//
// The metric is per plot rather than per comparison. A task carries a primary metric and
// whatever else it was scored in, and two tasks either share that whole set or have nothing to
// compare metric-wise — so the set is what groups the scores, and each group is read in one of
// its own metrics at a time. A score's group settles the metric its recordings are drawn in
// too, which is what keeps a bar and the panel it summarises in step.
//
// The picks and the fetches are comparison.js, which this hands a `render` to; how a
// host's rows name a score is the host's, as `toEntry`.
//
// Colours come from the palette unless the host's rows bring their own — see inkOf.

import { disposeAll } from "../core/disposable.js";
import { getElement, renderHtml } from "../core/render.js";
import { escapeHtml } from "../core/html.js";
import { mean, sem } from "../core/utils.js";
import { taskLabel } from "../core/suites.js";
import {
  buildComparisonGrid,
  buildPicks,
  dropFromClick,
} from "../components/comparisonGrid.js";
import {
  buildRecordingHeatmaps,
  createRecordingBars,
  createRecordingPlots,
  toScoreSeries,
} from "../plots/recordingScorePlots.js";
import { createBarPlots } from "../plots/bar.js";
import { CATEGORIES_PER_LINE } from "../plots/figure.js";
import { SERIES_COLOURS } from "../plots/palette.js";
import { loadTaskSubmission } from "../api/taskSubmissionApi.js";
import { TASK_FIELDS } from "../schemas/taskSubmissionSchema.js";
import {
  methodologyCells,
  methodologyColumns,
} from "../components/methodologyGrid.js";
import { EMPTY_STORE, toRecordingStore } from "../utils/recordingScoreUtils.js";
import { createComparison } from "./comparison.js";
import {
  buildSections,
  getSection,
  getSectionBody,
} from "../components/sections.js";
import { buildToggle } from "../components/buttons.js";
import { buildSelect } from "../components/filters.js";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

// Maximum number of scores that can be compared at once.
const MAX_COMPARED = 6;

// The means, the methodology grid and the recordings. Named rather than "summary" and
// "scores": a section is found by document id, and the record comparison that opens this
// underneath itself owns those.
const MEANS_SECTION = "means";
const METHODOLOGY_SECTION = "methodology";
const RECORDINGS_SECTION = "recordings";

// The row above them, written once so the ✕ on it can be delegated to one listener. Absent
// where the host said no — see `picks`.
const PICKS_ID = "score-picks";

// A metric select and the plot it belongs to. Read back off the two together, since the means
// row holds one select per plot.
const METRIC = "metric";
const GROUP = "group";

// The three ways the recordings behind the picked scores can be read: a plot per score with
// its marks as points, the same with its marks as bars, or a grid of cells. The buttons carry
// these ids, and a listener is attached to each once — see attachEvents.
const SEPARATE_VIEW = "separate-view";
const BARS_VIEW = "bars-view";
const HEATMAP_VIEW = "heatmap-view";

const VIEWS = [
  { id: SEPARATE_VIEW, label: "Separate", icon: "cards" },
  { id: BARS_VIEW, label: "Bars", icon: "score" },
  { id: HEATMAP_VIEW, label: "Heatmap", icon: "suite" },
];

// ─── ENTRIES ─────────────────────────────────────────────────────────────────

// Read off the detail rather than stamped onto the entry when it lands: a score unticked and
// reticked is a new entry answered from the cache, which never runs the fetch again. Keyed on
// the detail for the same reason, so the one that came back from the cache keeps its store.
const stores = new WeakMap();

function storeOf(entry) {
  const detail = entry.detail;

  if (!detail) return EMPTY_STORE;

  if (!stores.has(detail))
    stores.set(detail, toRecordingStore(detail.score?.metrics?.recordings));

  return stores.get(detail);
}

// The colour a score is drawn in, wherever it is drawn — its bar, its plot, its column in the
// grid.
//
// The one its row arrived with, where the host gave it one: a task opened from the record
// comparison is one row per record, and each keeps the colour its record wears in the plots
// above and in the table it was picked from. Otherwise the comparison's own reckoning, for a
// host whose rows have no colour to bring.
//
// Either way it is the pick's for as long as it is held, so a reader switching views or
// dropping another score doesn't have to find it again.
function inkOf(entry, colourOf) {
  return entry.colour ?? colourOf(entry.key);
}

// What a score is called wherever it is named: its chip above the panels, its series in a
// plot. One function, because a reader matching a colour to a name has to be matching one
// name.
function labelOf(entry) {
  return [entry.modelName ?? entry.submissionLabel, entry.taskId]
    .filter(Boolean)
    .join(" · ");
}

// ─── METRIC GROUPS ───────────────────────────────────────────────────────────

// What a score was measured in, in the order the scorers emitted them — which puts the task's
// primary metric first, and so makes it the metric a group opens on.
function metricsOf(entry) {
  return Object.keys(storeOf(entry).metrics);
}

// Two scores belong in one plot when they were measured in the same set of metrics. Sorted, so
// a pair whose scorers emitted them in a different order still groups together; what the
// group *offers* keeps the emitted order, off its first member.
//
// The whole set and not one metric: a task's metrics come as a set, and two tasks either share
// it — in which case every one of them is a comparison worth offering — or they have no
// metric in common to compare on at all.
function combinationOf(entry) {
  return metricsOf(entry).slice().sort().join("|");
}

/**
 * The picked scores in groups, in the order their first member was picked — so a plot doesn't
 * jump around the row when an unrelated score is added.
 *
 * A score whose own request hasn't landed has no metrics yet and is left out rather than
 * grouped with the others that have none: it would be a bar of nothing under a select with
 * nothing in it, and it joins its real group the moment the request answers.
 *
 * @returns [{ key, metrics, entries }].
 */
function toMetricGroups(entries) {
  const groups = new Map();

  for (const entry of entries) {
    const metrics = metricsOf(entry);

    if (!metrics.length) continue;

    const key = combinationOf(entry);

    if (!groups.has(key)) groups.set(key, { key, metrics, entries: [] });

    groups.get(key).entries.push(entry);
  }

  return [...groups.values()];
}

// The tasks a group covers, which is what its plot is labelled with: one task in the ordinary
// case, and the several that share a metric set where a reader has picked across them.
function tasksIn(group) {
  const names = [];

  for (const entry of group.entries) {
    const name = taskLabel(entry.taskId);

    if (name && !names.includes(name)) names.push(name);
  }

  return names.join(" · ");
}

// ─── MEANS ───────────────────────────────────────────────────────────────────

/**
 * One score's figure for one metric: the mean over the recordings it was measured on, and the
 * spread of that mean.
 *
 * The spread is over the recordings rather than the seed-level sems the scorers wrote. Those
 * say how firm one recording's own number is; a reader looking at a single bar per score is
 * asking how much the score moves from recording to recording, which is what a whisker on
 * this bar can answer.
 */
function summaryOf(entry, metric) {
  const values = (storeOf(entry).metrics[metric]?.mean ?? []).filter(
    (value) => value != null,
  );

  return { mean: mean(values), sem: sem(values) };
}

// One series per score, each a single bar: the plot is the group, so its axis holds one
// category and the scores are what is told apart on it — by colour, as everywhere else here.
function toMeanSeries(group, metric, colourOf) {
  return group.entries.map((entry) => {
    const summary = summaryOf(entry, metric);

    return {
      colour: inkOf(entry, colourOf),
      label: labelOf(entry),
      metric,
      group: group.key,
      index: new Map([[group.key, 0]]),
      values: { mean: [summary.mean], sem: [summary.sem] },
    };
  });
}

// The metric this plot is read in, above the plot itself: what the group shares is exactly
// what it offers, so the select can only name a metric every bar in it has.
//
// Which plot it belongs to is on the wrapper around both of them rather than here — see
// renderMeans, whose `data-group` is what a delegated change walks up to and what the figure
// is appended into.
function buildMetricSelect(group, metric) {
  return `
    <span class="row left gap-md">
      <span class="metadata">Metric</span>
      <span class="inline-select">
        ${buildSelect({
          name: METRIC,
          hook: "role",
          options: group.metrics.map((name) => ({ value: name, label: name })),
          selected: metric,
        })}
      </span>
    </span>`;
}

// ─── METHODOLOGY ─────────────────────────────────────────────────────────────

// `layout` is the grid's own — see buildComparisonGrid. Turned where this has half a row
// rather than a whole one: five fields are unreadable as a header on half a page and perfectly
// readable as a column of five, and the scores then grow sideways into whatever room is left
// rather than downwards. Given a row of its own it reads the other way, a score per row.
//
// Which score a column or row is, is its colour, matched to the chips above: the names are
// there, so a header repeating them under them would be the same list twice.
function buildMethodologyGrid(entries, fields, colourOf, layout) {
  return buildComparisonGrid({
    layout,
    attributes: methodologyColumns(fields),
    entities: entries.map((entry) => ({
      ink: inkOf(entry, colourOf),
      cells: methodologyCells({
        // Absent until this score's own request lands.
        record: entry.detail ?? null,
        fields,
      }),
    })),
  });
}

// ─── WIDGET ──────────────────────────────────────────────────────────────────

/**
 * @param container as createComparison.
 * @param toEntry   (row) => { key, taskId, submissionId, submissionLabel, modelName, metric,
 *                  colour? }. `key` is the task submission the score belongs to, which is also
 *                  what is fetched. `colour` is for a host whose rows are already drawn in one
 *                  — see inkOf.
 * @param prompt    what to say with nothing picked. The leaderboard's rows are one task's
 *                  scores across models, so it says "rows" where the scores page says "task
 *                  scores" — the same instruction about the same cap, in the words of
 *                  whatever table is above it.
 * @param layout    "stack" for a row each, which is what a page giving this its own width
 *                  wants; "row" for the means beside the methodology and the recordings under
 *                  the two, for a host fitting all three under something else — see
 *                  renderTaskDetail in recordComparison.js.
 * @param picks     false to leave out the row of chips. For a host that sets these picks
 *                  rather than the reader: it names them itself, in the same colours, and a ✕
 *                  here would take a score out only until the host next set them again.
 */
function createTaskComparison({
  container,
  layout = "stack",
  picks = true,
  ...options
}) {
  // Two of the three sharing a row rather than each having one, which is also what turns the
  // methodology grid and halves the means row's tracks.
  const beside = layout === "row";

  let view = SEPARATE_VIEW;

  // The reader's choice per group, keyed by the combination rather than by the plot's place in
  // the row: a score added to another group would otherwise move this one's choice along with
  // its plot. Not necessarily what is drawn — see metricInForce.
  const selectedMetrics = new Map();

  let comparison = null;

  // Per row, because the two are redrawn separately: a metric change redraws both, a view
  // change only the recordings.
  let meanCharts = [];
  let plotCharts = [];

  // Chart.js keeps a registry keyed on the canvas, so an instance whose container is about to
  // be rewritten has to be told.
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

    // The one render the controller does itself is the empty one, which never reaches
    // renderSections — so this is where the row is cleared.
    renderPicks();

    getSection(MEANS_SECTION).hidden = true;
    getSection(RECORDINGS_SECTION).hidden = true;
  }

  // ─── METRICS ───────────────────────────────────────────────────────────────

  // The metric a group is read in: the reader's while the group still offers it, else the
  // first it offers — which is the task's primary metric, since that is the order the scorers
  // emitted them in. Derived rather than written back, so `selectedMetrics` means what the
  // reader chose and nothing else.
  function metricInForce(group) {
    const wanted = selectedMetrics.get(group.key);

    if (wanted && group.metrics.includes(wanted)) return wanted;

    return group.metrics[0] ?? "";
  }

  // Every score's own metric, by key: what its group is being read in. The recordings below
  // are drawn in it, so a bar and the panel it summarises are always the same measurement.
  function metricsByScore() {
    const held = new Map();

    for (const group of toMetricGroups(comparison.entries())) {
      const metric = metricInForce(group);

      for (const entry of group.entries) held.set(entry.key, metric);
    }

    return held;
  }

  // ─── RENDER ────────────────────────────────────────────────────────────────

  // How many of the page's tracks this section's row is worth — see renderMeans.
  function tracks() {
    return beside
      ? Math.max(1, Math.ceil(CATEGORIES_PER_LINE / 2))
      : CATEGORIES_PER_LINE;
  }

  // The scores being compared, in the colours they are drawn in. Rewritten on every render,
  // which is what keeps the chips in step with the panels below — and emptied by clearUp, so
  // with nothing picked the row collapses rather than naming scores that have gone.
  function renderPicks() {
    const row = getElement(PICKS_ID);

    if (!row) return;

    const held = comparison
      ? comparison.entries().map((entry) => ({
          key: entry.key,
          label: labelOf(entry),
          ink: inkOf(entry, comparison.colourOf),
        }))
      : [];

    renderHtml(row, buildPicks(held), { refresh: true });
  }

  // One plot per group, each under its own metric select. Built one figure at a time rather
  // than as one arrangement, because the select belongs to the plot and an arrangement has
  // nowhere to put a control.
  //
  // Laid out on the page's own grid, a track per group, so these bars are the width the task
  // plots elsewhere are drawn at — see CATEGORIES_PER_LINE in plots/figure.js. Which also
  // means a group is the same width whether the reader is comparing one combination or four,
  // and a line's worth fill it before the rest wrap.
  //
  // Half the tracks where this section has half a row, so a track stays the same width on the
  // page rather than halving with the space around it.
  //
  // The figures inside are stacked rather than weighted: the grid cell is already one track
  // wide, and weighting again inside it would take a track of a track.
  function renderMeans() {
    const section = getSectionBody(MEANS_SECTION);

    clearMeans();

    const groups = toMetricGroups(comparison.entries());

    // The row's own visibility, since it is the only thing that knows whether there is
    // anything to draw: nothing until a score's request has landed and said what it measured.
    getSection(MEANS_SECTION).hidden = !groups.length;

    if (!groups.length) {
      renderHtml(section, "");

      return;
    }

    renderHtml(
      section,
      `<div class="chart-weighted" style="--plot-tracks:${tracks()}">
        ${groups
          .map(
            (group, at) => `
          <div class="column gap-sm" data-${GROUP}="${escapeHtml(String(at))}">
            ${buildMetricSelect(group, metricInForce(group))}
          </div>`,
          )
          .join("")}
      </div>`,
    );

    groups.forEach((group, at) => {
      const metric = metricInForce(group);

      const plots = createBarPlots({
        entries: toMeanSeries(group, metric, comparison.colourOf),
        // One group per plot, and one plot per call: the arrangement has nothing to arrange,
        // and stacking is the one layout that leaves the cell's width alone.
        facet: "metric",
        layout: "stack",
        size: "regular",
        order: "given",
        // The tasks the group covers. Its single category is the group itself, which is not a
        // thing a reader has a name for — the tasks in it are.
        tickLabel: () => tasksIn(group),
        // The chips above name the scores, and their colours are what tell the bars apart.
        legend: false,
      });

      section
        .querySelector(`[data-${GROUP}="${at}"]`)
        ?.appendChild(plots.element);

      meanCharts = meanCharts.concat(plots.charts);
    });
  }

  // Drawn as each score arrives rather than held until they all have: a row with its
  // methodology still missing is worth showing, and its plot fills in behind it. `refresh` for
  // whatever icon a cell brings with it.
  function renderGrid() {
    renderHtml(
      getSectionBody(METHODOLOGY_SECTION),
      buildMethodologyGrid(
        comparison.entries(),
        TASK_FIELDS,
        comparison.colourOf,
        beside ? "columns" : "rows",
      ),
      { refresh: true },
    );
  }

  function renderPlot() {
    const section = getSectionBody(RECORDINGS_SECTION);

    clearPlots();

    // Each score in the metric its own group is being read in, so a panel here and the bar
    // above it are the same measurement. The plots don't wait on the fields — nothing in them
    // is described by one.
    const metrics = metricsByScore();

    const entries = comparison.entries().map((entry) =>
      toScoreSeries(storeOf(entry), metrics.get(entry.key), {
        colour: inkOf(entry, comparison.colourOf),
        label: labelOf(entry),
      }),
    );

    if (view === HEATMAP_VIEW) {
      renderHtml(section, buildRecordingHeatmaps({ entries }));

      return;
    }

    // The same panels either way — one per score, the same recordings in the same order — and
    // only the mark different, which is the whole of the choice between these two buttons.
    //
    // One a row while there are few enough to be worth the width, two once there are more than
    // three: a recordings axis is long, and a plot with the whole line names ten of them where
    // half of it names five — but five stacked would put the last a screen below the first,
    // when the comparison is between them.
    //
    // A stack is also the one arrangement that can share an axis, and these can: every panel
    // draws the same recordings in the same order, so the labels under the bottom one are read
    // as the whole stack's. Two across, nothing sits above anything and each carries its own.
    const layout = entries.length < 4 ? "stack" : "pair";

    const draw = view === BARS_VIEW ? createRecordingBars : createRecordingPlots;

    const plots = draw({ entries, facet: "score", layout });

    section.replaceChildren(plots.element);
    plotCharts = plots.charts;
  }

  function setActiveView(view) {
    for (const { id } of VIEWS) {
      getElement(id)?.classList.toggle("primary-inv", id === view);
    }
  }

  function renderView(selectedView) {
    view = selectedView;
    setActiveView(view);

    // Only the recordings: which way they are read says nothing about the means above them or
    // the methodology beside them.
    renderPlot();
  }

  function renderSections() {
    // Put away by clearUp, and back once there is something to read. The means row shows
    // itself — see renderMeans, which is the only thing that knows whether it has groups.
    getSection(RECORDINGS_SECTION).hidden = false;

    setActiveView(view);

    renderPicks();
    renderMeans();
    renderGrid();
    renderPlot();
  }

  function attachEvents() {
    // On the row rather than on each chip: the chips are rewritten on every render, and the
    // row they sit in is written once.
    getElement(PICKS_ID)?.addEventListener("click", (event) => {
      const key = dropFromClick(event);

      if (key) comparison.drop(key);
    });

    for (const { id } of VIEWS) {
      getElement(id)?.addEventListener("click", () => {
        if (id !== view) renderView(id);
      });
    }

    // Delegated on the means section's body, which outlives the plots and the selects inside
    // it: both are rewritten whenever the picks or a metric change.
    //
    // Both rows: the group's bar is that metric's mean, and the recordings under it are the
    // measurements it is the mean of. The methodology is untouched — which metric a score is
    // read in says nothing about how it was produced.
    getSectionBody(MEANS_SECTION).addEventListener("change", (event) => {
      const select = event.target.closest(`[data-role='${METRIC}']`);

      if (!select) return;

      const at = Number(select.closest(`[data-${GROUP}]`)?.dataset[GROUP]);
      const group = toMetricGroups(comparison.entries())[at];

      if (!group) return;

      selectedMetrics.set(group.key, select.value);

      renderMeans();
      renderPlot();
    });
  }

  function setup() {
    const means = { id: MEANS_SECTION, title: "Mean scores", hidden: true };
    const methodology = { id: METHODOLOGY_SECTION, title: "Methodology" };
    const recordings = {
      id: RECORDINGS_SECTION,
      title: "Recordings",
      actions: [buildToggle(VIEWS)],
      hidden: true,
    };

    // Beside: the means and the methodology share the top row and the recordings take the one
    // under it. This is a panel inside another comparison, already a page deep, and three
    // full-width rows would put the recordings a page and a half below the plot they were
    // opened from — where the two short things fit side by side and the long one wants the
    // width anyway.
    //
    // A row each otherwise, which is what a page of its own can afford.
    const sections = beside
      ? [{ sections: [means, methodology] }, recordings]
      : [means, methodology, recordings];

    renderHtml(
      container,
      `
        ${picks ? `<span class="row left gap-sm compare-picks" id="${PICKS_ID}"></span>` : ""}
        ${buildSections(sections)}`,
    );

    attachEvents();

    comparison = createComparison({
      // The methodology section: with nothing picked, the prompt belongs where the grid would
      // have been, and the other two sections are hidden anyway. The section body outlives it,
      // which is what lets the listeners above be attached once.
      container: getSectionBody(METHODOLOGY_SECTION),
      max: MAX_COMPARED,
      prompt: `Select up to ${MAX_COMPARED} task scores to compare them.`,
      palette: SERIES_COLOURS,

      loadDetail: (entry) => loadTaskSubmission(entry.submissionId, entry.key),

      render: renderSections,
      clearUp,

      ...options,
    });

    return comparison;
  }

  return setup();
}

export { MAX_COMPARED, createTaskComparison };
