// One task score, opened: how it was produced, and what it measured on every recording.
//
// The other half of what a reader does with a row — the comparison is several scores side
// by side, this is one of them in full. Separate for the same reason: the scores page opens
// it from a list of task scores, the leaderboard from a board of models on one task, and
// both want the same thing underneath.
//
// The breakdown and the methodology arrive together, one request, because a listing carries
// the figure a table shows and nothing behind it.

import { escapeHtml } from "../core/html.js";
import { refreshIcons, renderHtml } from "../core/render.js";
import { buildEmptyMessage } from "../components/messages.js";
import { disposeAll } from "../core/disposable.js";
import { buildToggle } from "../components/buttons.js";
import { resolveContainer } from "../core/dom.js";
import { EMPTY_STORE, toRecordingStore } from "../utils/recordingScoreUtils.js";
import { renderRecordingScoresTable } from "../tables/recordingScoreTable.js";
import {
  createRecordingPlots,
  toScoreSeries,
} from "../plots/recordingScorePlots.js";
import { SERIES_INK } from "../plots/palette.js";
import { buildDisplayFields } from "../forms/fields.js";
import {
  TASK_FIELDS,
  trainingFieldKeys,
} from "../schemas/taskSubmissionSchema.js";
import { loadTaskSubmission } from "../api/taskSubmissionApi.js";

// The two ways to read one score: the shape of it, or the numbers — the same pair the model
// comparison offers. The plot leads because the question a reader opens a score with is how
// it varies across recordings, and 29 rows of numbers answer that slowly.
//
// Its own ids rather than the comparison's: the leaderboard shows a breakdown and a model
// comparison on one page, and an id belongs to one element.
const PLOT_VIEW = "breakdown-plot-view";
const TABLE_VIEW = "breakdown-table-view";

const VIEWS = [
  { id: PLOT_VIEW, label: "Plot", icon: "score" },
  { id: TABLE_VIEW, label: "Table", icon: "table" },
];

// The first of them, so the order on screen and the one a score opens in can't disagree.
// Sticky for the rest of the visit once a reader chooses: whoever wants the numbers for one
// score usually wants them for the next.
const DEFAULT_VIEW = PLOT_VIEW;

// Built once per breakdown and written into thereafter: the toggle outlives every score
// opened, so its listeners are attached when this is written and not again.
const LAYOUT = `
  <div class="column gap-md">
    <div class="row">
      <span class="column gap-xs" data-role="heading"></span>
      ${buildToggle(VIEWS)}
    </div>
    <div data-role="fields"></div>
    <div data-role="view"></div>
  </div>`;

/**
 * @param container element, or the id of one. Its contents are replaced.
 * @param prompt    what to say with nothing open.
 *
 * @returns { show(seed), clear() }. `seed` is `{ key, taskId, submissionId, submissionLabel,
 *          modelName }` — what a listing already knows.
 */
function createTaskBreakdown({
  container,
  prompt = "Select a task score to see how it was measured.",
}) {
  const root = resolveContainer(container);

  let seed = null;
  let detail = null;
  let store = EMPTY_STORE;
  let view = DEFAULT_VIEW;
  let charts = [];

  // Chart.js keeps a registry keyed on the canvas, so an instance whose container is about
  // to be rewritten has to be told: otherwise it goes on answering resizes from a detached
  // element and the next chart on that canvas throws.
  function clearCharts() {
    disposeAll(charts);
    charts = [];
  }

  function slot(name) {
    return root.querySelector(`[data-role='${name}']`);
  }

  function renderPanel() {
    const target = slot("view");

    clearCharts();

    // The breakdown arrives with the methodology, so both halves of the view wait on one
    // request — and "not fetched yet" reads differently from "this score has none".
    if (!detail) {
      renderHtml(target, buildEmptyMessage("Loading the breakdown…"));
      return;
    }

    if (!store.index.size) {
      renderHtml(
        target,
        buildEmptyMessage(
          "No per-recording breakdown was stored for this score.",
        ),
      );
      return;
    }

    if (view === PLOT_VIEW) {
      // One plot per metric, all of them for the one score. No palette: these are the same
      // result measured several ways rather than several results, so one colour throughout
      // and no legend — the axis names the metric and the heading names the score.
      const plots = createRecordingPlots({
        entries: Object.keys(store.metrics).map((metric) =>
          toScoreSeries(store, metric, {
            colour: SERIES_INK,
            label: seed.taskId,
          }),
        ),
        // Read across: the metrics are the same recordings measured differently, and a score
        // has few enough of them to sit side by side.
        layout: "row",
        legend: false,
      });

      target.replaceChildren(plots.element);
      charts = plots.charts;

      return;
    }

    renderRecordingScoresTable({ container: target, store });
  }

  function setActiveView(view) {
    for (const { id } of VIEWS) {
      // Scoped to this breakdown's own root, so a second one on the page lights its own.
      root
        .querySelector(`#${id}`)
        ?.classList.toggle("primary-inv", id === view);
    }
  }

  function renderView(selectedView) {
    view = selectedView;
    setActiveView(view);

    // Only the panel: which way the score is read says nothing about its methodology.
    renderPanel();
  }

  function attachEvents() {
    for (const { id } of VIEWS) {
      root.querySelector(`#${id}`)?.addEventListener("click", () => {
        if (id !== view) renderView(id);
      });
    }
  }

  // The layout survives every score opened; `clear` replaces it with the prompt, so this
  // puts it back — and the toggle's listeners go on with the buttons they were made for.
  function ensureLayout() {
    if (slot("view")) return;

    renderHtml(root, LAYOUT);
    attachEvents();
  }

  // The methodology behind the numbers, in the same words the comparison grid uses. Absent
  // until its own request lands, which is a line of text rather than an empty card.
  function renderFields() {
    renderHtml(
      slot("fields"),
      detail
        ? `<div class="card"><div class="grid-4">${buildDisplayFields(trainingFieldKeys(), detail, TASK_FIELDS)}</div></div>`
        : `<p class="metadata">Loading methodology…</p>`,
    );
  }

  function render() {
    ensureLayout();

    renderHtml(
      slot("heading"),
      `<h3 class="section-title">${escapeHtml(seed.taskId)}</h3>
      <p class="metadata">${escapeHtml(
        [seed.modelName, seed.submissionLabel].filter(Boolean).join(" · "),
      )}</p>`,
    );

    setActiveView(view);

    renderFields();
    renderPanel();
    refreshIcons();
  }

  async function show(entry) {
    seed = entry;
    detail = null;
    store = EMPTY_STORE;

    // Before the fetch: the heading and the toggle are known from the seed, and the two
    // halves below say they are loading.
    render();

    let detailed = {};

    try {
      detailed = await loadTaskSubmission(entry.submissionId, entry.key);
    } catch (error) {
      console.error(error);
    }

    // Only if it is still the score on screen — a reader can open another while this lands.
    if (seed !== entry) return;

    detail = detailed;
    store = toRecordingStore(detailed.score?.metrics?.recordings);

    render();
  }

  function clear() {
    clearCharts();
    seed = null;
    detail = null;
    store = EMPTY_STORE;
    renderHtml(root, buildEmptyMessage(prompt));
  }

  clear();

  return { show, clear };
}

// A breakdown is fed by one row rather than by a set of picks, so attach and apply have
// nothing to do. The shape is bindTableSelection's — see comparisons/comparison.js.
function bindTableDetail(breakdown, toEntry) {
  return {
    selection: () => ({
      max: 1,
      onChange: (rows) =>
        rows.length ? breakdown.show(toEntry(rows[0])) : breakdown.clear(),
    }),
    attach: () => {},
    apply: (mutate) => mutate(),
  };
}

export { bindTableDetail, createTaskBreakdown };
