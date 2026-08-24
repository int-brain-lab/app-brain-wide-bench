// Compare page — one reference model against up to five others, on one task suite.
//
// Two ways in, and the difference between them is one control:
//
//   /compare.html?id=<model>   from a model's own page. That model is the reference, the
//                              page is titled after it, and there is a way back to it.
//   /compare.html              from the models list. Nothing is the reference yet, so the
//                              page opens on a dropdown to choose one and fills in behind.
//
// Everything after the reference is settled is identical, which is why `id` and `ref` are
// separate parameters rather than one: they name the same model but say different things
// about the page, and a refresh has to land back in the mode it was in.
//
// A single view, so it boots through loadPage rather than loadRecordPage: there is no
// second screen to route to, and the state that does vary belongs in the URL as a
// comparison anyone can send to someone else, not as a stack of history entries left
// behind by working the controls.
//
// The sections, in the order they answer the reader's questions:
//
//   reference    which model is this about — only when the page wasn't told
//   suite        which suite, from the ones the reference has been scored on
//   models       who to compare against — at most five, all of which have that suite
//   metric       narrow every section below to one metric
//   overview     one bar per model, best first
//   breakdown    every task, mean ± sem, models across the top
//   differences  the same grid against a baseline the reader picks

import { escapeHtml, refreshIcons, showEmpty, showMessage } from "../core/utils.js";
import { getIcon } from "../components/icons.js";
import { buildSuiteBadgeList } from "../components/badges.js";
import { suiteFromTask } from "../core/suites.js";
import { sortSuites } from "../tables/formatters.js";
import { latestScoresByTask } from "../core/scoreData.js";
import { buildModelScoreBars } from "../components/bars.js";
import { getModels, loadModel } from "../api/modelApi.js";
import { loadPage } from "../templates/page-loader.js";
import { MAX_SELECTED, renderModelPicker } from "../widgets/modelPicker.js";
import { applyMetricFilter, renderCompareTable, showNoComparison } from "../tables/compareTable.js";
import {
  compareMetrics,
  compareModels,
  compareTasks,
  entriesForMetric,
  tasksForMetric,
  toCompareEntries,
  toDiffRows,
  toScoreRows,
} from "../core/compareData.js";
import {
  buildHeader,
  buildPage,
  buildSection,
  buildSections,
  renderHeader,
  renderPage,
  sectionBody,
} from "../templates/record-page.js";


// ─── CONFIGURATION ───────────────────────────────────────────────────────────

const MODEL_PAGE = "/html/models/models.html";

const PICK_TITLE = "Compare models";
const PICK_DESCRIPTION = "Pick a reference model, then up to five others to measure against it.";

// `with` rather than `models`: it reads as the sentence the URL is making, and `models` is
// already what the page's own model list is called.
const SUITE_PARAM = "suite";
const WITH_PARAM = "with";
const METRIC_PARAM = "metric";
const BASELINE_PARAM = "baseline";
const REF_PARAM = "ref";

// Every section below the controls, so they can be hidden together while there is nothing
// to put in them.
const RESULT_SECTIONS = ["overview", "breakdown", "differences"];
const CONTROL_SECTIONS = ["suite", "models", "metric"];


// ─── URL STATE ───────────────────────────────────────────────────────────────

// Nothing is validated here. Which suites exist depends on the reference, which metrics
// exist depends on the tasks the chosen models turn out to have been scored on, and the
// reference itself may have been deleted since the URL was written. Each is checked by
// whichever renderer knows the answer, and falls back there.
function readSelection() {
  const params = new URLSearchParams(location.search);

  return {
    ref: params.get(REF_PARAM) ?? "",
    suite: params.get(SUITE_PARAM) ?? "",
    withIds: (params.get(WITH_PARAM) ?? "").split(",").filter(Boolean),
    metric: params.get(METRIC_PARAM) ?? "",
    baseline: params.get(BASELINE_PARAM) ?? "",
  };
}

// replaceState, not pushState: a comparison is built by working four dropdowns, and each
// change would otherwise be a history entry the reader has to press Back through to leave
// the page. The URL still survives a refresh and can still be sent to someone.
//
// Each parameter is dropped rather than written empty, so the plainest version of the page
// leaves the plainest URL.
function writeSelection({ ref, suite, withIds, metric, baseline }) {
  const params = new URLSearchParams(location.search);

  const entries = {
    [REF_PARAM]: ref,
    [SUITE_PARAM]: suite,
    [WITH_PARAM]: withIds.join(","),
    [METRIC_PARAM]: metric,
    [BASELINE_PARAM]: baseline,
  };

  for (const [key, value] of Object.entries(entries)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }

  history.replaceState(history.state, "", `?${params}`);
}


// ─── DATA ────────────────────────────────────────────────────────────────────

// From the model's own scores rather than the list endpoint's `task_suites`, so the
// dropdown can only ever offer a suite the page has something to draw for. The two agree
// today — both count a suite once it has a scored task — but only one of them is the data
// this page actually renders.
function suitesOf(model) {
  const suites = Object.keys(latestScoresByTask(model.submissions))
    .map(suiteFromTask)
    .filter(Boolean);

  return sortSuites([...new Set(suites)]);
}

// Only models with something scored: `task_suites` is empty until a submission of theirs
// has a score, and a reference with nothing on it can only produce an apology.
function referenceOptions(models) {
  return models
    .filter(candidate => candidate.task_suites?.length)
    .map(candidate => ({
      value: candidate.id,
      // The team disambiguates two models with the same name, which is allowed across
      // teams — the uniqueness rule is per team.
      label: candidate.team_name ? `${candidate.name} — ${candidate.team_name}` : candidate.name,
    }));
}

// Every other model the caller can see that has been scored on this suite. `task_suites` is
// only populated by the list endpoint — a detail response leaves it empty — which is why
// the page fetches the list as well as the model.
function candidatesFor(models, referenceId, suite) {
  return models
    .filter(candidate => candidate.id !== referenceId)
    .filter(candidate => (candidate.task_suites ?? []).includes(suite))
    .map(candidate => ({
      id: candidate.id,
      name: candidate.name,
      teamName: candidate.team_name,
    }));
}


// ─── MARKUP ──────────────────────────────────────────────────────────────────

/**
 * @param options  [{value, label}].
 * @param selected the value to open on.
 * @param blank    the leading "don't narrow" option's label. Omit for a select that must
 *                 hold one of its options — the suite, which the page is scoped to.
 *
 * Every select on the page, rather than four near-identical builders: they are the same
 * control with different contents, and only the blank option differs.
 */
function buildSelect(role, options, selected, blank = null) {
  const items = options
    .map(option => `
      <option value="${escapeHtml(option.value)}" ${option.value === selected ? "selected" : ""}>
        ${escapeHtml(option.label)}
      </option>
    `)
    .join("");

  // Nothing to choose between: one suite, or one metric across every task on it.
  const closed = options.length <= 1 && !blank;

  return `
    <select class="input-select" data-role="${escapeHtml(role)}" ${closed ? "disabled" : ""}>
      ${blank ? `<option value="">${escapeHtml(blank)}</option>` : ""}
      ${items}
    </select>
  `;
}

function getSubtitle(model, suite) {
  return [
    { text: model.team_name, icon: getIcon("team") },
    { text: suite ? `Comparing on ${suite.toUpperCase()}` : null, icon: getIcon("suite") },
  ].filter(entry => entry.text);
}


// ─── PAGE ────────────────────────────────────────────────────────────────────

function renderComparePage({ model, models, fixedId }) {
  // The reference is fixed by how the reader arrived, or theirs to choose. It is the one
  // thing that decides what the page looks like rather than only what it says.
  const selectable = !fixedId;

  renderPage(
    buildPage({
      // Only one way back, and only when there is somewhere to go back to.
      header: buildHeader(model
        ? [{
            href: `${MODEL_PAGE}?id=${encodeURIComponent(model.id)}`,
            label: "Back to model",
            icon: getIcon("model"),
          }]
        : []),

      // The controls share a row: together they are one question — which model, on which
      // suite, against whom, narrowed to which metric. `align-start` because the picker
      // grows a line as chips are added, and .page-section's space-between would otherwise
      // push the other selects to the bottom of cells stretched to match it.
      body:
        `<div class="section-row align-start">${buildSections([
          ...(selectable ? [{ id: "reference", title: "Reference model" }] : []),
          { id: "suite", title: "Task suite" },
          { id: "models", title: "Compare with" },
          { id: "metric", title: "Metric" },
        ])}</div>` +
        // Untitled: it holds whatever is standing in for the page — "choose a model" — and
        // a heading over that would be a heading over an apology.
        buildSection({ id: "intro" }) +
        buildSections([
          { id: "overview", title: "Overview" },
          { id: "breakdown", title: "Task breakdown" },
          { id: "differences", title: "Differences" },
        ]),
    }),
  );

  // renderPage writes the header's icon placeholders; nothing else on the page calls into
  // lucide, and the router that used to do this for every view isn't in the way any more.
  refreshIcons();

  const state = readSelection();

  // Whichever model the page is currently about, and the suites it has been scored on.
  // Both change when the reference does, which is why neither is a constant.
  let reference = model ?? null;
  let suites = [];

  // Seeded with the model already in hand, so a fixed reference is never fetched twice, and
  // held across renders so unticking a model and ticking it again costs nothing. It doubles
  // as the reference cache — a reader trying three references pays for each one once.
  const details = new Map(model ? [[model.id, Promise.resolve(model)]] : []);

  function detailFor(id) {
    if (!details.has(id)) details.set(id, loadModel(id));

    return details.get(id);
  }

  // Replacing a section's contents detaches a Tabulator's element but doesn't free it — its
  // own registry keeps the instance and its ResizeObserver alive. The router did this for
  // views; here the page re-renders these sections itself, so it does it itself.
  let grids = { breakdown: null, differences: null };

  function releaseGrid(name) {
    grids[name]?.destroy?.();
    grids[name] = null;
  }

  function releaseGrids() {
    releaseGrid("breakdown");
    releaseGrid("differences");
  }

  // What the last fetch produced, so changing the metric or the baseline can redraw without
  // going back to the API — the scores are already here, only the arithmetic over them
  // changes.
  let results = { entries: [], tasks: [] };

  // Every render of the results is a fetch, and a reader working the controls quickly can
  // have two in flight. Without this the slower one lands last and draws a comparison
  // nobody asked for.
  let latestRender = 0;

  function showSections(ids, shown) {
    for (const id of ids) {
      const section = sectionBody(id)?.closest("section");

      if (section) section.hidden = !shown;
    }
  }

  // Narrows a set of chosen ids to the ones that can actually be compared on the current
  // suite, in the order the reader asked for them, and no more than the picker would allow.
  function pruneSelection(withIds) {
    const allowed = new Set(
      candidatesFor(models, reference?.id, state.suite).map(candidate => candidate.id),
    );

    return withIds.filter(id => allowed.has(id)).slice(0, MAX_SELECTED);
  }


  // ─── SECTIONS ──────────────────────────────────────────────────────────────

  function renderReference() {
    const container = sectionBody("reference");

    container.innerHTML = buildSelect(
      "reference",
      referenceOptions(models),
      reference?.id ?? "",
      "Choose a model…",
    );

    container.querySelector("[data-role='reference']").addEventListener("change", event => {
      useReference(event.target.value);
    });
  }

  function renderSuite() {
    const container = sectionBody("suite");

    container.innerHTML = buildSelect(
      "suite",
      suites.map(suite => ({ value: suite, label: suite.toUpperCase() })),
      state.suite,
    );

    container.querySelector("[data-role='suite']").addEventListener("change", event => {
      state.suite = event.target.value;

      // A comparator chosen for the old suite may not have the new one. Pruned here rather
      // than left to the picker, so the URL stays honest about what is being compared.
      state.withIds = pruneSelection(state.withIds);

      writeSelection(state);
      renderTitle();
      renderPicker();
      renderResults();
    });
  }

  function renderPicker() {
    renderModelPicker({
      container: sectionBody("models"),
      candidates: candidatesFor(models, reference.id, state.suite),
      selectedIds: state.withIds,
      onChange: ids => {
        state.withIds = ids;
        writeSelection(state);
        renderResults();
      },
    });
  }

  // Rebuilt whenever the results are, because which metrics exist depends on the tasks the
  // chosen models were scored on. A metric that has gone with them falls back to "all"
  // rather than leaving every section filtered to nothing.
  function renderMetricFilter(metrics) {
    if (!metrics.some(option => option.value === state.metric)) state.metric = "";

    // The URL may have named a metric that this set of models doesn't have; the fallback
    // above has just dropped it, so the address bar has to be told.
    writeSelection(state);

    const container = sectionBody("metric");

    container.innerHTML = buildSelect("metric", metrics, state.metric, "All metrics");

    container.querySelector("[data-role='metric']").addEventListener("change", event => {
      state.metric = event.target.value;
      writeSelection(state);

      // Filtered in place, not rebuilt: the grids are already mounted with these rows, and
      // rebuilding them would throw away whatever column the reader had sorted by.
      applyMetricFilter(grids.breakdown, state.metric);
      applyMetricFilter(grids.differences, state.metric);

      renderOverview();
    });
  }

  // The bars are means, so narrowing to a metric is not a filter on them — the mean has to
  // be taken again over the tasks that survive. Which also reorders the section: "best
  // first" on bacc alone is a different order from "best first" overall, and that is the
  // point of asking.
  function renderOverview() {
    const entries = entriesForMetric(results.entries, state.metric);
    const tasks = tasksForMetric(results.tasks, state.metric);

    sectionBody("overview").innerHTML = buildModelScoreBars(entries, {
      suite: state.suite,
      totalTasks: tasks.length,
    });
  }

  function renderBreakdown() {
    const { entries, tasks } = results;

    releaseGrid("breakdown");

    grids.breakdown = tasks.length
      ? renderCompareTable({
          container: sectionBody("breakdown"),
          rows: toScoreRows(entries, tasks),
          models: compareModels(entries),
          metric: state.metric,
          mode: "score",
        })
      : showNoComparison(sectionBody("breakdown"), "No scored tasks on this suite.");
  }

  // The one section with a control of its own. The reference, the suite, the models and the
  // metric all shape every section, so they live in the row at the top; the baseline shapes
  // only this grid, and putting it anywhere else would claim otherwise.
  function buildBaselineBar(entries) {
    const options = entries.map(entry => ({ value: entry.modelId, label: entry.modelName }));

    // Wrapped, because .section-body has no layout of its own — without this the control
    // and the grid sit flush against each other.
    return `
      <div class="column gap-md">
        <div class="row left gap-md">
          <span class="metadata">Difference from</span>
          <span class="inline-select">${buildSelect("baseline", options, state.baseline)}</span>
        </div>
        <div data-role="diff-grid"></div>
      </div>
    `;
  }

  function renderDifferences() {
    const { entries, tasks } = results;
    const container = sectionBody("differences");

    releaseGrid("differences");

    // A baseline named in the URL, or left over from a model that has since been unticked,
    // falls back to the reference — the only model guaranteed to be in every comparison.
    if (!entries.some(entry => entry.modelId === state.baseline)) {
      state.baseline = reference.id;
      writeSelection(state);
    }

    // Fewer than two models is nothing to subtract, and no tasks is nothing to subtract it
    // over — either way there is no grid and so no baseline to choose.
    if (!tasks.length || entries.length < 2) {
      showNoComparison(container, "Choose a model above to see the difference.");
      return;
    }

    container.innerHTML = buildBaselineBar(entries);

    container.querySelector("[data-role='baseline']").addEventListener("change", event => {
      state.baseline = event.target.value;
      writeSelection(state);

      // Rebuilt rather than refiltered: both the rows and the columns change, since the
      // baseline is the one model the grid doesn't show.
      renderDifferences();
    });

    grids.differences = renderCompareTable({
      container: container.querySelector("[data-role='diff-grid']"),
      rows: toDiffRows(entries, tasks, state.baseline),
      models: compareModels(entries, { exclude: state.baseline }),
      metric: state.metric,
      mode: "diff",
    });
  }

  async function renderResults() {
    const token = ++latestRender;

    releaseGrids();

    for (const id of RESULT_SECTIONS) {
      showMessage(sectionBody(id), "Loading scores…");
    }

    // A catch per model rather than one around the lot: a comparator that has become
    // unreadable — unshared while the page was open — shouldn't take the other four down
    // with it. It drops out of the comparison and the count below the grid says so.
    const loaded = await Promise.all(
      [reference.id, ...state.withIds].map(id =>
        detailFor(id).catch(error => {
          console.error(`Could not load model ${id} for comparison:`, error);
          details.delete(id);
          return null;
        }),
      ),
    );

    if (token !== latestRender) return;

    const entries = toCompareEntries(loaded.filter(Boolean), state.suite, reference.id);
    const tasks = compareTasks(entries);

    results = { entries, tasks };

    // Before the rest, so the metric they are drawn for is one that exists.
    renderMetricFilter(compareMetrics(tasks));

    renderOverview();
    renderBreakdown();
    renderDifferences();
  }


  // ─── REFERENCE ─────────────────────────────────────────────────────────────

  function renderTitle() {
    // In pick mode the reference is named by its own dropdown, so the heading says what the
    // page is for instead of repeating it — and stays put as the reader tries one model
    // after another.
    if (selectable) {
      renderHeader(PICK_TITLE, PICK_DESCRIPTION);
      return;
    }

    renderHeader(
      reference.name,
      getSubtitle(reference, state.suite),
      [buildSuiteBadgeList(suites)],
    );
  }

  // Nothing chosen, or nothing to show for what was: the controls and the results have
  // nothing to say, so they are hidden rather than left standing empty under their titles.
  function renderIntro(message) {
    releaseGrids();

    showSections([...CONTROL_SECTIONS, ...RESULT_SECTIONS], false);
    showSections(["intro"], true);

    showEmpty(sectionBody("intro"), message);
  }

  /**
   * Point the page at a model. Everything below the reference depends on it — which suites
   * can be chosen, which models are candidates, every score on the page — so this is the
   * one path that rebuilds all of it, and the only place `reference` is assigned.
   */
  async function useReference(id) {
    if (!id) {
      reference = null;
      suites = [];
      state.ref = "";

      writeSelection(state);
      renderTitle();
      renderIntro("Choose a reference model to compare against.");
      return;
    }

    // Between the click and the scores there is a fetch, and on a cold cache it is the
    // whole page. Said once here rather than in each of the six sections behind it.
    renderIntro("Loading model…");

    const next = await detailFor(id).catch(error => {
      console.error(`Could not load model ${id}:`, error);
      return null;
    });

    if (!next) {
      details.delete(id);
      renderIntro("That model could not be loaded.");
      return;
    }

    reference = next;
    suites = suitesOf(next);
    state.ref = selectable ? next.id : "";

    // The suite and the comparators were chosen against whatever the reference used to be.
    if (!suites.includes(state.suite)) state.suite = suites[0] ?? "";
    state.withIds = pruneSelection(state.withIds);

    writeSelection(state);
    renderTitle();

    if (!suites.length) {
      renderIntro(`${next.name} has no scored tasks yet, so there is nothing to compare.`);
      return;
    }

    showSections(["intro"], false);
    showSections([...CONTROL_SECTIONS, ...RESULT_SECTIONS], true);

    renderSuite();
    renderPicker();

    return renderResults();
  }


  // ─── START ─────────────────────────────────────────────────────────────────

  if (selectable) renderReference();

  // `ref` only in pick mode: in fixed mode the URL's `id` is the reference, and a stray
  // `ref` from a copied link must not quietly redirect the page to a different model.
  return useReference(fixedId ?? (selectable ? state.ref : ""));
}


// ─── LOAD ────────────────────────────────────────────────────────────────────

loadPage({
  noun: "model",

  // The id is optional — without one the page opens on its reference dropdown — so it is
  // read here rather than by loadPage, which would refuse the page for the lack of it.
  requiresId: false,

  // A model with a public submission is readable by anyone — see GET /api/models/{id} —
  // and so is the model list this page picks its comparators from.
  requiresAuth: false,

  load: async () => {
    const fixedId = new URLSearchParams(location.search).get("id");

    const [model, models] = await Promise.all([
      fixedId ? loadModel(fixedId) : null,
      getModels(),
    ]);

    // Only a fixed reference can fail this way; without one there is nothing yet to miss.
    if (fixedId && !model) return null;

    return { model, models: models ?? [], fixedId };
  },

  render: renderComparePage,
});
