// Several task scores read side by side: how each was produced, and what each measured.
//
// The half of the comparison that isn't the table. It is separate because the table it
// hangs under isn't always the same one — the scores page selects rows out of a list of
// task scores, and the leaderboard selects them out of a board of models on one task — and
// both want this underneath: a methodology grid, and the numbers as small multiples, as one
// overlaid chart, or as a heatmap.
//
// The host owns the selection and the cap; this owns everything downstream of it. Each
// entry's per-recording breakdown and methodology arrive together, one request each, and
// the views fill in as they land — a listing carries the figure a table shows and nothing
// behind it, which is why there is a request at all.

import { refreshIcons, showEmpty } from "../core/utils.js";
import { buildViewToggle, viewFromClick } from "../components/viewToggle.js";
import { resolveContainer } from "../tables/table.js";
import { buildMethodologyGrid } from "../tables/methodologyGrid.js";
import { recordingMetricNames } from "../tables/recordingScoreTable.js";
import { renderRecordingCharts, renderRecordingHeatmaps } from "../charts/recordingChart.js";
import { SERIES_INK, seriesStyle } from "../charts/palette.js";
import { loadTaskSubmission } from "../api/taskSubmissionApi.js";
import { loadTaskFields } from "../schemas/taskSubmissionSchema.js";


// ─── CONFIGURATION ───────────────────────────────────────────────────────────

// Six: two rows of three small multiples, and six rows of methodology a reader can hold at
// once. Not a colour limit — separate panels don't colour by score at all — though it is
// also the point past which the overlaid view runs out of colour-and-shape pairs.
const MAX_COMPARED = 6;

// Separate panels lead because they hold any number of scores and stay comparable; overlaid
// is the closer read, for when the question is which series is above which at a given
// recording; the heatmap answers where rather than how much.
const VIEWS = [
  { value: "separate", label: "Separate", icon: "cards" },
  { value: "overlaid", label: "Overlaid", icon: "score" },
  { value: "heatmap", label: "Heatmap", icon: "suite" },
];

const PROMPT = `Select up to ${MAX_COMPARED} task scores to compare them.`;


// ─── ENTRIES ────────────────────────────────────────────────────────────────

// The score's own metric where the breakdown reports one the reader can choose — a TS3
// score's metrics are named per region, so its primary ("macro/f1-score") is not one of the
// suffixes on offer, and the first suffix stands in. Only answerable once the breakdown has
// arrived; until then the primary stands, which is what the table shows.
function defaultMetric(metric, recordings) {
  const names = recordingMetricNames(recordings);

  if (!names.length) return metric;

  return names.includes(metric) ? metric : names[0];
}

// Overlaid, a series is told apart by how it looks, so it takes the nth colour and shape.
// Separate, the panel's title says which score it is and every mark takes one ink — six
// hues a reader can tell apart do not exist, and a panel per score means none are needed.
function toSeriesEntry(entry, index, overlaid) {
  const style = overlaid ? seriesStyle(index) : { colour: SERIES_INK };

  return {
    key: entry.key,
    ...style,
    label: `${entry.modelName ?? entry.submissionLabel ?? ""} · ${entry.taskId}`,
    metric: entry.metric,
    recordings: entry.recordings,
  };
}


// ─── WIDGET ─────────────────────────────────────────────────────────────────

/**
 * @param container element, or the id of one. Its contents are replaced.
 * @param onDrop    (key) => void, when a reader removes a score from the grid. The
 *                  selection lives in the host's table, so only the host can act on it.
 *
 * @returns { show(seeds), clear() }. `seeds` are `{ key, taskId, submissionId,
 *          submissionLabel, modelName, metric }` — what a listing already knows — and
 *          `show` returns the keys it had no room for, for the host to deselect.
 */
function createTaskComparison({ container, onDrop = () => {} }) {
  const root = resolveContainer(container, "createTaskComparison");

  let entries = [];
  let charts = [];
  let fields = null;
  let view = VIEWS[0].value;

  // Chart.js keeps a registry keyed on the canvas, so an instance whose container is about
  // to be rewritten has to be told: otherwise it goes on answering resizes from a detached
  // element and the next chart on that canvas throws.
  function clearCharts() {
    charts.forEach(chart => chart?.destroy?.());
    charts = [];
  }

  function buildToggle() {
    return buildViewToggle({ views: VIEWS, active: view, role: "compare-view" });
  }

  function renderGrid() {
    root.querySelector("[data-role='grid']").innerHTML =
      buildMethodologyGrid(entries, fields) + buildToggle();

    // The grid is rewritten on every change and each row carries a Lucide placeholder for
    // its remove button, so swapping them in is this caller's job.
    refreshIcons();
  }

  function renderPlot() {
    const plot = root.querySelector("[data-role='plot']");
    const overlaid = view === "overlaid";

    if (view === "heatmap") {
      clearCharts();
      renderRecordingHeatmaps({ container: plot, entries: entries.map(toSeriesEntry) });

      return;
    }

    charts = renderRecordingCharts({
      container: plot,
      entries: entries.map((entry, index) => toSeriesEntry(entry, index, overlaid)),
      charts,
      facet: overlaid ? "metric" : "score",
      // Overlaid is the close read — six series on one pair of axes, where what matters is
      // the gaps between them — so it gets the room the small multiples don't need.
      size: overlaid ? "tall" : "regular",
    });
  }

  function render() {
    if (!entries.length) {
      clearCharts();
      showEmpty(root, PROMPT);

      return;
    }

    // Rebuilt rather than reused: the empty state above replaces the whole area, so the two
    // slots are gone by the time there is something to put in them.
    if (!root.querySelector("[data-role='grid']")) {
      root.innerHTML = `<div data-role="grid"></div><div data-role="plot"></div>`;
    }

    renderGrid();
    renderPlot();
  }

  // Fetched per selection: the methodology fields and the per-recording breakdown are both
  // on the detail response only, and a reader compares a handful of scores, not three
  // hundred. A failure leaves the row without its fields rather than taking the comparison
  // down.
  async function loadDetail(entry) {
    try {
      entry.detail = await loadTaskSubmission(entry.submissionId, entry.key);
      entry.recordings = entry.detail.score?.metrics?.recordings ?? [];
      entry.metric = defaultMetric(entry.metric, entry.recordings);
    } catch (error) {
      console.error(error);
      entry.detail = {};
    }

    // Both, because the breakdown is what the plot is drawn from: a comparison renders
    // empty panels until each request lands, and fills in as they do.
    if (entries.includes(entry)) {
      renderGrid();
      renderPlot();
    }
  }

  // Reconciles rather than diffs, because a host hands over its whole selection: what is
  // gone drops out, what is new is appended, and everything else keeps its position — which
  // is what stops the rows and the panels reshuffling when one score is removed.
  async function show(seeds) {
    const keys = seeds.map(seed => seed.key);
    const overflow = [];

    entries = entries.filter(entry => keys.includes(entry.key));

    // Loaded once, on the first comparison: nothing else needs the field definitions, and a
    // reader who never compares never pays for them.
    if (seeds.length && !fields) fields = await loadTaskFields();

    for (const seed of seeds) {
      if (entries.some(entry => entry.key === seed.key)) continue;

      if (entries.length >= MAX_COMPARED) {
        overflow.push(seed.key);
        continue;
      }

      const entry = { ...seed, recordings: [], detail: null };

      entries.push(entry);
      loadDetail(entry);
    }

    render();

    return overflow;
  }

  function clear() {
    clearCharts();
    entries = [];
    showEmpty(root, PROMPT);
  }

  // Delegated, because the grid is rewritten on every change and per-row listeners would be
  // re-bound each time — and the remove button has to reach a table this widget has no
  // handle on.
  root.addEventListener("change", event => {
    const select = event.target.closest("[data-role='metric']");

    if (!select) return;

    const entry = entries.find(item => item.key === select.dataset.key);

    if (!entry) return;

    entry.metric = select.value;
    renderPlot();
  });

  root.addEventListener("click", event => {
    const drop = event.target.closest("[data-role='drop']");

    if (drop) {
      onDrop(drop.dataset.key);
      return;
    }

    const chosen = viewFromClick(event, "compare-view");

    if (chosen && chosen !== view) {
      view = chosen;
      renderGrid();
      renderPlot();
    }
  });

  clear();

  return { show, clear };
}


export { MAX_COMPARED, createTaskComparison };
