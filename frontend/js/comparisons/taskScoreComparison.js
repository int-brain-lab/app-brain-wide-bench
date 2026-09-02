// Several task scores side by side: how each was measured, and what it did per recording.
//
//   methodology  one row per score, one column per training field, the metric first
//   recordings   every recording behind those scores — separate plots, one overlaid plot,
//                or a heatmap
//
// The picks, the fetches and the ✕ are comparison.js, which this hands a `render`
// to; how a host's rows name a score is the host's, as `toEntry`.
//
// The metric is per score rather than per comparison: two scores of the same task can be
// recorded under different metrics, and the reader picks which one each is drawn in.

import { escapeHtml } from "../core/html.js";
import { disposeAll } from "../core/disposable.js";
import { getElement, renderHtml } from "../core/render.js";
import { buildSuiteBadgeList } from "../components/badges.js";
import {
  buildComparisonGrid,
  buildRowHeader,
} from "../components/comparisonGrid.js";
import {
  buildRecordingHeatmaps,
  createRecordingPlots,
  toScoreSeries,
} from "../plots/recordingScorePlots.js";
import { SERIES_COLOURS } from "../plots/palette.js";
import { loadTaskSubmission } from "../api/taskSubmissionApi.js";
import { TASK_FIELDS } from "../schemas/taskSubmissionSchema.js";
import {
  methodologyCells,
  methodologyColumns,
} from "../components/methodologyGrid.js";
import { suiteFromTask } from "../core/suites.js";
import { EMPTY_STORE, toRecordingStore } from "../utils/recordingScoreUtils.js";
import { createComparison } from "./comparison.js";
import {
  buildSections,
  getSection,
  getSectionBody,
} from "../components/sections.js";
import { buildToggle } from "../components/buttons.js";
import { buildOptions } from "../components/filters.js";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

// Maximum number of scores that can be compared at once.
const MAX_COMPARED = 6;

// The methodology grid and the recordings under it. Named rather than "summary" and "scores":
// a section is found by document id, and the model comparison on the same page owns those.
const METHODOLOGY_SECTION = "methodology";
const RECORDINGS_SECTION = "recordings";

// The three ways the recordings behind the picked scores can be read: a plot each, one plot
// holding them all, or a grid of cells. The buttons carry these ids, and a listener is
// attached to each once — see attachEvents.
const SEPARATE_VIEW = "separate-view";
const OVERLAID_VIEW = "overlaid-view";
const HEATMAP_VIEW = "heatmap-view";

const VIEWS = [
  { id: SEPARATE_VIEW, label: "Separate", icon: "cards" },
  { id: OVERLAID_VIEW, label: "Overlaid", icon: "score" },
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

// The reader's choice where they have made one and it still exists, the row's own metric
// otherwise, and the first recorded one where neither holds.
function metricOf(entry) {
  const names = Object.keys(storeOf(entry).metrics);

  if (!names.length || names.includes(entry.metric)) return entry.metric;

  return names[0];
}

// Coloured by the comparison's own reckoning, whichever way the plots are read: a score keeps
// one colour whether it shares a plot with the others or has one of its own, and keeps it
// when another score is dropped — so a reader switching views doesn't have to find it again.
function toSeriesEntry(entry, colourOf) {
  return toScoreSeries(storeOf(entry), metricOf(entry), {
    colour: colourOf(entry.key),
    label: `${entry.modelName ?? entry.submissionLabel ?? ""} · ${entry.taskId}`,
  });
}

// ─── METHODOLOGY ─────────────────────────────────────────────────────────────

// The one cell that is a control rather than a reading: which metric this score's panel is
// drawn in. Its value is the metric, so the column still mutes when they all agree.
function buildMetricCell(entry) {
  const metric = metricOf(entry);

  const options = Object.keys(storeOf(entry).metrics).map((name) => ({
    value: name,
    label: name,
  }));

  return {
    value: metric ?? "",
    // Its own `<select>` rather than buildSelect's: the delegated listener finds which score
    // changed by `data-key`, and buildSelect has no way to carry a second attribute.
    html: `
      <select
        class="input-select"
        data-role="metric"
        data-key="${escapeHtml(entry.key)}"
      >
        ${buildOptions(options, { selected: metric })}
      </select>`,
  };
}

// Which score this row is. The submission sits under the task because two rows of the same
// task across two models is the comparison this is for.
function buildScoreHeader(entry) {
  const suite = suiteFromTask(entry.taskId);

  return buildRowHeader({
    key: entry.key,
    title: `
      <span class="label">${escapeHtml(entry.taskId)}</span>
      ${suite ? buildSuiteBadgeList([suite], "sm") : ""}`,
    meta: [entry.modelName, entry.submissionLabel].filter(Boolean).join(" · "),
    name: entry.taskId,
  });
}

function buildMethodologyGrid(entries, fields, colourOf) {
  return buildComparisonGrid({
    columns: methodologyColumns(fields),
    rows: entries.map((entry) => ({
      key: entry.key,
      header: buildScoreHeader(entry),
      ink: colourOf(entry.key),
      cells: methodologyCells({
        // Absent until this score's own request lands.
        record: entry.detail ?? null,
        fields,
        metricCell: buildMetricCell(entry),
      }),
    })),
  });
}

// ─── WIDGET ──────────────────────────────────────────────────────────────────

/**
 * @param container as createComparison.
 * @param toEntry   (row) => { key, taskId, submissionId, submissionLabel, modelName, metric }.
 *                  `key` is the task submission the score belongs to, which is also what is
 *                  fetched.
 * @param prompt    what to say with nothing picked. The leaderboard's rows are one task's
 *                  scores across models, so it says "rows" where the scores page says "task
 *                  scores" — the same instruction about the same cap, in the words of
 *                  whatever table is above it.
 */
function createTaskComparison({ container, ...options }) {

  let view = SEPARATE_VIEW;

  let comparison = null;

  let plotCharts = [];

  // Chart.js keeps a registry keyed on the canvas, so an instance whose container is about to
  // be rewritten has to be told.
  function clearCharts() {
    disposeAll(plotCharts);
    plotCharts = [];
  }

  function clearUp() {
    clearCharts();

    getSection(RECORDINGS_SECTION).hidden = true;
  }

  // ─── RENDER ────────────────────────────────────────────────────────────────

  // Drawn as each score arrives rather than held until they all have: a row with its
  // methodology still missing is worth showing, and its plot fills in behind it. `refresh`
  // because the ✕ on each row is an icon.
  function renderGrid() {
    renderHtml(
      getSectionBody(METHODOLOGY_SECTION),
      buildMethodologyGrid(
        comparison.entries(),
        TASK_FIELDS,
        comparison.colourOf,
      ),
      { refresh: true },
    );
  }

  function renderPlot() {
    const section = getSectionBody(RECORDINGS_SECTION);

    clearCharts();

    // The plots don't wait on the fields — nothing in them is described by one.
    const entries = comparison
      .entries()
      .map((entry) => toSeriesEntry(entry, comparison.colourOf));

    if (view === HEATMAP_VIEW) {
      renderHtml(section, buildRecordingHeatmaps({ entries }));

      return;
    }

    const overlaid = view === OVERLAID_VIEW;

    const plots = createRecordingPlots({
      entries,
      facet: overlaid ? "metric" : "score",
      // Overlaid, a plot holds every score at once and is read closely, so two across gives
      // each the width for its series without pushing the second metric below the fold.
      layout: overlaid ? "pair" : undefined,
      size: overlaid ? "tall" : "regular",
    });

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

    // Only the panel: which way the recordings are read says nothing about the methodology
    // above them.
    renderPlot();
  }

  function renderSections() {
    // Put away by clearUp, and back once there is something to read.
    getSection(RECORDINGS_SECTION).hidden = false;

    setActiveView(view);

    renderGrid();
    renderPlot();
  }

  function attachEvents() {
    for (const { id } of VIEWS) {
      getElement(id)?.addEventListener("click", () => {
        if (id !== view) renderView(id);
      });
    }

    // On the section rather than on the selects in it: the grid is rebuilt whenever a score
    // is picked or its detail lands, and a listener on a select would go with the old
    // element. The section body is the layout's own and outlives every render.
    getSectionBody(METHODOLOGY_SECTION).addEventListener("change", (event) => {
      const select = event.target.closest("[data-role='metric']");

      if (!select) return;

      const entry = comparison
        .entries()
        .find((item) => item.key === select.dataset.key);

      if (!entry) return;

      entry.metric = select.value;

      renderPlot();
    });
  }

  function setup() {
    renderHtml(
      container,
      buildSections([
        { id: METHODOLOGY_SECTION },
        {
          id: RECORDINGS_SECTION,
          title: "Recordings",
          actions: [buildToggle(VIEWS)],
          hidden: true,
        },
      ]),
    );

    attachEvents();

    comparison = createComparison({
      // The methodology section: with nothing picked, the prompt belongs where the grid would
      // have been, and the recordings section is hidden anyway. The section body outlives it,
      // which is what lets the metric listener above be attached once.
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
