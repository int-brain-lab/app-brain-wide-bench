// Several models side by side: what they are, and how they scored on one suite.
//
// The model twin of taskComparison.js, and mounted the same way — under whatever table the
// reader picked from, rather than on a page of its own. It is the model comparison page's
// two grids without its overview: the bars there are a mean per model, which is the figure
// the board above is already sorted by.
//
//   summary      one row per model, one column per specification field
//   breakdown    every task on the suite, as a plot or as a grid — models across the top
//   differences  the same again, measured against a baseline the reader picks
//
// The two score sections each carry their own plot-or-grid toggle: a reader comparing shapes
// in one is often reading numbers off the other.
//
// The model records arrive one request each, on selection: a board row names a model but
// carries none of its specification, and a reader compares a handful, not a hundred.

import {
  escapeHtml,
  refreshIcons,
  showEmpty,
  showMessage,
} from "../core/utils.js";
import { getIcon } from "../components/icons.js";
import { buildViewToggle, viewFromClick } from "../components/viewToggle.js";
import { resolveContainer } from "../tables/table.js";
import { buildComparisonGrid } from "../tables/comparisonGrid.js";
import {
  renderCompareTable,
  showNoComparison,
} from "../tables/compareTable.js";
import {
  renderCompareCharts,
  renderDiffCharts,
} from "../charts/compareChart.js";
import {
  compareModels,
  compareTasks,
  toCompareEntries,
  toDiffRows,
  toScoreRows,
} from "../core/compareData.js";
import { displayValue } from "../forms/fields.js";
import { SUITES, suitesFromSubmission } from "../core/suites.js";
import { loadModel } from "../api/modelApi.js";
import { MODEL_FIELDS, loadModelMeta } from "../schemas/modelSchema.js";
import { fieldsForPanel } from "../schemas/schema.js";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

// The comparison page's own cap, since this opens the same comparison with the same models.
const MAX_MODELS = 5;

// The plot leads: the question a reader opens a comparison with is which model is ahead and
// by how much, and a dozen rows of "mean ± sem" answers that slowly. The grid is a click
// away for the numbers themselves.
const DEFAULT_VIEW = "plot";

// The specification panel — architecture and pretraining. Not identity (the row header is
// the name) and not the links, which are somewhere to go rather than something to compare.
const SUMMARY_PANEL = 3;

// ─── SUMMARY ────────────────────────────────────────────────────────────────

function buildRowHeader(model) {
  return `
    <span class="column gap-xs">
      <span class="row left gap-sm">
        <button
          type="button"
          class="chip-remove"
          data-role="drop"
          data-key="${escapeHtml(model.key)}"
          title="Remove ${escapeHtml(model.name)}"
          aria-label="Remove ${escapeHtml(model.name)}"
        >
          <i class="field-icon" data-lucide="${escapeHtml(getIcon("remove"))}"></i>
        </button>
        <a class="label" href="/html/models/models.html?id=${escapeHtml(model.modelId)}">
          ${escapeHtml(model.name)}
        </a>
      </span>
      <span class="metadata">${escapeHtml(model.teamName ?? "")}</span>
    </span>`;
}

// Absent until the model's own request lands, which reads as "not known yet" rather than
// "not set".
function valueOf(detail, key, fields) {
  if (!detail) return null;

  const value = displayValue(fields[key], detail[key]);

  return value == null || value === "" ? null : String(value);
}

function buildSummary(models, fields) {
  const keys = fieldsForPanel(MODEL_FIELDS, SUMMARY_PANEL, false);

  return buildComparisonGrid({
    columns: keys.map((key) => ({ key, label: fields[key]?.label ?? key })),
    rows: models.map((model) => ({
      key: model.key,
      header: buildRowHeader(model),
      cells: Object.fromEntries(
        keys.map((key) => [key, { value: valueOf(model.detail, key, fields) }]),
      ),
    })),
  });
}

// ─── WIDGET ─────────────────────────────────────────────────────────────────

/**
 * @param container element, or the id of one. Its contents are replaced.
 * @param onDrop    (key) => void, when a reader removes a model. The selection lives in the
 *                  host's table, so only the host can act on it.
 * A score is a fact about a model *on a suite*, so there is always one in force. Which
 * control names it is settled per call rather than per widget: a host that passes one to
 * `show` owns it — the compare page's suite select, the leaderboard's metric select on a
 * suite — and one that passes nothing gets the widget's own select instead, offering the
 * suites the chosen models have actually been scored on. That is the leaderboard on
 * Overall, where the metric select names no suite, and the models list, which has no such
 * control at all.
 *
 * @returns { show(seeds, suite), clear() }. `seeds` are `{ key, modelId, name, teamName }`
 *          — what a board row already knows — and `show` returns the keys it had no room
 *          for, for the host to deselect.
 */
function createModelComparison({ container, onDrop = () => {} }) {
  const root = resolveContainer(container, "createModelComparison");

  let models = [];
  let suite = "";
  let fields = null;
  let baseline = "";

  // The suite the host last named, "" for "you choose". Held rather than read off `suite`,
  // which is whatever is on screen: the two differ exactly when this widget is choosing.
  let hostSuite = "";

  // Whether the suite on screen is the reader's choice or this widget's guess. The models
  // arrive one request at a time, so a guess made when the first landed would otherwise
  // stick even after a model with an earlier suite joined it.
  let suiteChosen = false;
  let grids = { breakdown: null, differences: null };

  // Which way each section is being read, and the charts drawn where it is the plot. Sticky
  // for the life of the widget: a reader who came for the numbers on one suite wants them on
  // the next one too.
  let views = { breakdown: DEFAULT_VIEW, differences: DEFAULT_VIEW };
  let charts = { breakdown: [], differences: [] };

  // Tabulator keeps its own registry, so a grid whose container is about to be rewritten
  // has to be destroyed or its element and observer outlive the render.
  function clearGrids() {
    for (const key of Object.keys(grids)) {
      grids[key]?.destroy?.();
      grids[key] = null;
    }
  }

  // Chart.js keeps the same kind of registry, keyed on the canvas: an instance whose
  // container is about to be rewritten goes on answering resizes from a detached element,
  // and the next chart on that canvas throws.
  function clearCharts() {
    for (const key of Object.keys(charts)) {
      charts[key].forEach((chart) => chart?.destroy?.());
      charts[key] = [];
    }
  }

  // Cached across selections: a reader ticking a fifth model shouldn't refetch the four
  // already on screen, and unticking and reticking one is common.
  const details = new Map();

  function slot(name) {
    return root.querySelector(`[data-role='${name}']`);
  }

  // ── the breakdown, and the difference grid ──

  // The role a section's toggle buttons carry, which is also how a click is read back. One
  // per section rather than one shared: both toggles are delegated to the same root, so a
  // shared role would have each switching the other.
  function toggleRole(section) {
    return `model-${section}-view`;
  }

  // Only where there are two ways to read: with nothing scored on the suite, or no second
  // model to subtract, the toggle would switch between two empty states.
  function renderToggle(section, shown) {
    const bar = slot(`${section}-toggle`);

    if (!bar) return;

    bar.innerHTML = shown
      ? buildViewToggle({ active: views[section], role: toggleRole(section) })
      : "";

    // Rendered after render()'s own refresh — the scores are drawn from renderScores, which
    // the suite, baseline and view controls all call on their own — so the buttons swap
    // their Lucide placeholders here rather than waiting for the next full render.
    if (shown) refreshIcons();
  }

  function renderBreakdown(entries, tasks) {
    renderToggle("breakdown", tasks.length > 0);

    if (!tasks.length) {
      grids.breakdown = showNoComparison(
        slot("breakdown"),
        "No scored tasks on this suite.",
      );

      return;
    }

    if (views.breakdown === "plot") {
      charts.breakdown = renderCompareCharts({
        container: slot("breakdown"),
        entries,
        tasks,
        charts: charts.breakdown,
      });

      return;
    }

    grids.breakdown = renderCompareTable({
      container: slot("breakdown"),
      rows: toScoreRows(entries, tasks),
      models: compareModels(entries),
      mode: "score",
    });
  }

  // The one part with a control of its own: which model everything else is measured
  // against. It lives with the grid it shapes rather than at the top, where it would look
  // like it shaped the others too.
  function renderDifferences(entries, tasks) {
    const container = slot("differences");

    // Fewer than two models is nothing to subtract, and no tasks is nothing to subtract it
    // over — either way there is no comparison, and so no baseline to choose and no view to
    // choose between.
    const comparable = tasks.length >= 1 && entries.length >= 2;

    renderToggle("differences", comparable);

    if (!comparable) {
      showNoComparison(
        container,
        "Select a second model to see the difference.",
      );
      return;
    }

    if (!entries.some((entry) => entry.modelId === baseline))
      baseline = entries[0].modelId;

    const options = entries
      .map(
        (entry) => `
        <option value="${escapeHtml(entry.modelId)}" ${entry.modelId === baseline ? "selected" : ""}>
          ${escapeHtml(entry.modelName)}
        </option>`,
      )
      .join("");

    container.innerHTML = `
      <div class="column gap-md">
        <span class="row left gap-md">
          <span class="metadata">Measured against</span>
          <span class="inline-select">
            <select class="input-select" data-role="baseline">${options}</select>
          </span>
        </span>
        <div data-role="diff-body"></div>
      </div>`;

    const body = container.querySelector("[data-role='diff-body']");

    if (views.differences === "plot") {
      charts.differences = renderDiffCharts({
        container: body,
        entries,
        tasks,
        baselineId: baseline,
        charts: charts.differences,
      });

      return;
    }

    grids.differences = renderCompareTable({
      container: body,
      rows: toDiffRows(entries, tasks, baseline),
      models: compareModels(entries, { exclude: baseline }),
      mode: "diff",
    });
  }

  // The suites the selection has scores on, in the app's own order. Derived rather than
  // offered as a fixed three: a suite nobody here has entered is an empty grid and a dead
  // option.
  function availableSuites() {
    const scored = new Set(
      models.flatMap((model) =>
        (model.detail?.submissions ?? []).flatMap(suitesFromSubmission),
      ),
    );

    return SUITES.filter((candidate) => scored.has(candidate));
  }

  /**
   * The widget's own suite control, where the host named none — see the note on
   * createModelComparison.
   *
   * The choice is settled here rather than in `show`, because it depends on what the models
   * turned out to have been scored on: the first suite any of them has, until the reader
   * says otherwise. A reader's choice that the current selection has no scores on falls
   * back the same way, so removing the only model with TS3 doesn't leave an empty grid
   * under a suite nobody here has entered.
   */
  function renderSuiteBar() {
    const bar = slot("suite-bar");

    if (hostSuite) {
      // The host's control names it; a second select beside it could only disagree.
      if (bar) bar.innerHTML = "";

      return;
    }

    const available = availableSuites();

    if (!suiteChosen || !available.includes(suite)) suite = available[0] ?? "";

    if (bar) bar.innerHTML = available.length ? buildSuiteBar() : "";
  }

  function buildSuiteBar() {
    const options = availableSuites()
      .map(
        (candidate) => `
        <option value="${escapeHtml(candidate)}" ${candidate === suite ? "selected" : ""}>
          ${escapeHtml(candidate.toUpperCase())}
        </option>`,
      )
      .join("");

    return `
      <span class="row left gap-md">
        <span class="metadata">Task suite</span>
        <span class="inline-select">
          <select class="input-select" data-role="suite">${options}</select>
        </span>
      </span>`;
  }

  function renderScores() {
    clearGrids();
    clearCharts();

    const loaded = models.map((model) => model.detail).filter(Boolean);

    // Before the suite, because which suites are on offer is read off the models' own
    // scores: until every one of them has landed, "no suite to compare on" and "not yet"
    // look exactly alike. The select above keeps whatever it last offered rather than
    // emptying and refilling as each model arrives.
    if (loaded.length < models.length) {
      renderToggle("breakdown", false);
      renderToggle("differences", false);
      showMessage(slot("breakdown"), "Loading scores…");
      showMessage(slot("differences"), "Loading scores…");

      return;
    }

    renderSuiteBar();

    // The specification is a fact about a model; a score is a fact about a model on a
    // suite. So the summary stands on its own, and with no suite in force there is nothing
    // for these two to be about — which, now that one is chosen wherever the host names
    // none, means none of the chosen models has been scored at all.
    if (!suite) {
      const note = "None of these models has a scored task suite yet.";

      renderToggle("breakdown", false);
      renderToggle("differences", false);
      showNoComparison(slot("breakdown"), note);
      showNoComparison(slot("differences"), note);

      return;
    }

    const entries = toCompareEntries(loaded, suite, models[0]?.modelId);
    const tasks = compareTasks(entries);

    renderBreakdown(entries, tasks);
    renderDifferences(entries, tasks);
  }

  function render() {
    if (!root.querySelector("[data-role='summary']")) {
      root.innerHTML = `
        <div class="column gap-lg">
          <div data-role="summary"></div>
          <div class="column gap-md">
            <div class="row">
              <h3 class="section-title">Task breakdown</h3>
              <div class="row right gap-md">
                <span data-role="suite-bar"></span>
                <div data-role="breakdown-toggle"></div>
              </div>
            </div>
            <div data-role="breakdown"></div>
          </div>
          <div class="column gap-md">
            <div class="row">
              <h3 class="section-title">Differences</h3>
              <div data-role="differences-toggle"></div>
            </div>
            <div data-role="differences"></div>
          </div>
        </div>`;
    }

    slot("summary").innerHTML = buildSummary(models, fields);
    refreshIcons();

    renderScores();
  }

  async function loadDetail(model) {
    if (!details.has(model.modelId))
      details.set(model.modelId, loadModel(model.modelId));

    try {
      model.detail = await details.get(model.modelId);
    } catch (error) {
      console.error(error);
      details.delete(model.modelId);
      model.detail = {};
    }

    if (models.includes(model)) render();
  }

  /**
   * @param seeds one per picked model, in the order they were picked: the first is the
   *              reference the others are read against, as on the comparison page.
   * @param next  the suite the scores are compared on, or "" for none yet.
   */
  async function show(seeds, next) {
    hostSuite = next ?? "";

    // The host's suite wins outright and is not the reader's to override here; without one,
    // `suite` keeps whatever the reader last chose and renderSuiteBar settles it.
    if (hostSuite) {
      suite = hostSuite;
      suiteChosen = false;
    }

    const keys = seeds.map((seed) => seed.key);
    const overflow = [];

    models = models.filter((model) => keys.includes(model.key));

    // Loaded once: the field definitions are the same for every model, and a reader who
    // never compares never pays for them.
    if (seeds.length && !fields) fields = await loadModelMeta();

    for (const seed of seeds) {
      if (models.some((model) => model.key === seed.key)) continue;

      if (models.length >= MAX_MODELS) {
        overflow.push(seed.key);
        continue;
      }

      const model = { ...seed, detail: null };

      models.push(model);
      loadDetail(model);
    }

    if (!models.length) clear();
    else render();

    return overflow;
  }

  function clear() {
    clearGrids();
    clearCharts();
    models = [];
    suiteChosen = false;
    showEmpty(root, `Select up to ${MAX_MODELS} models to compare them.`);
  }

  // Delegated: the summary is rewritten on every change, and the baseline select is rebuilt
  // with its grid.
  root.addEventListener("click", (event) => {
    for (const section of Object.keys(views)) {
      const chosen = viewFromClick(event, toggleRole(section));

      if (!chosen) continue;

      if (chosen !== views[section]) {
        views[section] = chosen;
        renderScores();
      }

      return;
    }

    const drop = event.target.closest("[data-role='drop']");

    if (drop) onDrop(drop.dataset.key);
  });

  root.addEventListener("change", (event) => {
    if (event.target.closest("[data-role='suite']")) {
      suite = event.target.value;
      suiteChosen = true;
      renderScores();

      return;
    }

    if (!event.target.closest("[data-role='baseline']")) return;

    baseline = event.target.value;

    // Rebuilt rather than refiltered: both the rows and the columns change, since the
    // baseline is the one model the grid doesn't show.
    renderScores();
  });

  clear();

  return { show, clear, MAX_MODELS };
}

export { MAX_MODELS, createModelComparison };
