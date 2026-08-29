// Compare page — one model against a handful of others, on one task suite.
//
// One way in: /compare.html?id=<model>, from that model's own page. The model is the
// reference, the page is titled after it, and there is a way back to it. The models list
// used to offer a second entrance, to the same page with nothing chosen and a dropdown to
// choose it — that went when the list grew a compare mode of its own, and the dropdown went
// with it.
//
// The comparison itself is not this page's: it is the same widget the leaderboard and the
// models list mount under their own tables — the specification grid, the task breakdown and
// the differences, each as a plot or a grid. So this page is only what leads to it:
//
//   suite        which suite, from the ones the reference has been scored on
//   models       every model scored on that suite, as a table. Picking a row adds it to the
//                comparison; the reference's own row is picked from the start, since a
//                comparison this page is titled after cannot leave it out
//   comparison   the widget, which fetches what it needs itself
//
// A single view, so it boots through loadPage rather than loadRecordPage: there is no
// second screen to route to, and the state that does vary belongs in the URL as a
// comparison anyone can send to someone else, not as a stack of history entries left
// behind by working the controls.

import { escapeHtml } from "../core/html.js";
import { refreshIcons, renderHtml } from "../core/render.js";
import { buildEmptyMessage } from "../components/messages.js";
import { dispose } from "../core/disposable.js";
import { getIcon } from "../components/icons.js";
import { buildSuiteBadgeList } from "../components/badges.js";
import { suiteFromTask } from "../core/suites.js";
import { sortSuites } from "../tables/formatters.js";
import { latestScoresByTask } from "../core/scoreData.js";
import { getModels, loadModel } from "../api/modelApi.js";
import { toModelRows } from "../utils/modelUtils.js";
import { loadPage } from "../templates/page.js";
import { createModelsTable } from "../tables/modelTable.js";
import { MAX_MODELS, createModelComparison } from "../comparisons/models.js";
import { bindTableSelection } from "../widgets/comparison.js";
import { renderHeader, renderPage } from "../templates/pageChrome.js";
import {
  buildHeader,
  buildPage,
  buildSection,
  buildSections,
  getSection,
  getSectionBody,
} from "../components/sections.js";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

const MODEL_PAGE = "/html/models/models.html";

const BACK_TEXT = "← Back to model";

// `with` rather than `models`: it reads as the sentence the URL is making, and `models` is
// already what the page's own model list is called.
const SUITE_PARAM = "suite";
const WITH_PARAM = "with";

// The table and the comparison under it, so they can be hidden together while there is
// nothing to put in them.
const RESULT_SECTIONS = ["models", "comparison"];
const CONTROL_SECTIONS = ["suite"];

// One short of the widget's own cap, because the reference is the fifth: the comparison
// holds MAX_MODELS in total and this page's reference is always one of them.
const MAX_COMPARATORS = MAX_MODELS - 1;

// ─── URL STATE ───────────────────────────────────────────────────────────────

// Nothing is validated here. Which suites exist depends on the reference, and a model named
// in `with` may have been deleted since the URL was written. Each is checked by whichever
// renderer knows the answer, and falls back there.
function readSelection() {
  const params = new URLSearchParams(location.search);

  return {
    suite: params.get(SUITE_PARAM) ?? "",
    withIds: (params.get(WITH_PARAM) ?? "").split(",").filter(Boolean),
  };
}

// replaceState, not pushState: a comparison is built by working a dropdown and a table, and
// each change would otherwise be a history entry the reader has to press Back through to
// leave the page. The URL still survives a refresh and can still be sent to someone.
//
// Each parameter is dropped rather than written empty, so the plainest version of the page
// leaves the plainest URL.
function writeSelection({ suite, withIds }) {
  const params = new URLSearchParams(location.search);

  const entries = {
    [SUITE_PARAM]: suite,
    [WITH_PARAM]: withIds.join(","),
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

/**
 * Every model the table should hold: the ones scored on this suite, and the reference
 * whether or not it is among them.
 *
 * `task_suites` is only populated by the list endpoint — a detail response leaves it empty
 * — which is why the page fetches the list as well as the model. The reference is added
 * back by id for the same reason: its own row would otherwise depend on the two sources
 * agreeing, and the row it is picked in cannot be missing.
 */
function modelsOnSuite(models, referenceId, suite) {
  return models.filter(
    (candidate) =>
      candidate.id === referenceId ||
      (candidate.task_suites ?? []).includes(suite),
  );
}

// ─── MARKUP ──────────────────────────────────────────────────────────────────

/**
 * The page's one control. Every option is a real choice — the suite the page is scoped to
 * has no "don't narrow" — so there is no blank first entry.
 *
 * @param options  [{value, label}].
 * @param selected the value to open on.
 */
function buildSelect(role, options, selected) {
  const items = options
    .map(
      (option) => `
      <option value="${escapeHtml(option.value)}" ${option.value === selected ? "selected" : ""}>
        ${escapeHtml(option.label)}
      </option>
    `,
    )
    .join("");

  // Nothing to choose between: a reference scored on one suite.
  const closed = options.length <= 1;

  // Inline rather than stretched: .input-select is full-width, and a lone select across the
  // page reads as a field to fill in rather than a scope to pick.
  return `
    <span class="inline-select">
      <select class="input-select" data-role="${escapeHtml(role)}" ${closed ? "disabled" : ""}>
        ${items}
      </select>
    </span>
  `;
}

function getSubtitle(model, suite) {
  return [
    { text: model.team_name, icon: getIcon("team") },
    {
      text: suite ? `Comparing on ${suite.toUpperCase()}` : null,
      icon: getIcon("suite"),
    },
  ].filter((entry) => entry.text);
}

// ─── LINKS ───────────────────────────────────────────────────────────────────

function getModelHref(model) {
  return `${MODEL_PAGE}?id=${encodeURIComponent(model.id)}`;
}

// ─── PAGE ────────────────────────────────────────────────────────────────────

function renderComparePage({ model, models }) {
  renderPage(
    buildPage({
      back: { text: BACK_TEXT, href: getModelHref(model) },
      header: buildHeader(),

      body:
        buildSection({ id: "suite", title: "Task suite" }) +
        // Untitled: it holds whatever is standing in for the page — a reference with nothing
        // scored — and a heading over that would be a heading over an apology.
        buildSection({ id: "intro" }) +
        buildSections([
          { id: "models", title: "Models on this suite" },
          { id: "comparison", title: "Comparison" },
        ]),
    }),
  );

  // renderPage writes the header's icon placeholders; nothing else on the page calls into
  // lucide until a table or the widget does its own.
  refreshIcons();

  const state = readSelection();

  // The model the page is about, and the suites it has been scored on. Fixed for the life of
  // the page: the reference is how the reader arrived, and everything below it — which
  // suites can be chosen, which models the table holds, every score on the page — is read
  // off it.
  const reference = model;
  const suites = suitesOf(model);

  let table = null;

  // The whole of what was three sections: the specification grid, the task breakdown and
  // the differences, in whichever view the reader last chose. It holds what is picked; the
  // table above is bound to it, so a ✕ inside the comparison unticks the row that put it
  // there.
  const comparison = createModelComparison({
    container: getSectionBody("comparison"),

    toEntry: (row) => ({
      key: row.id,
      modelId: row.id,
      name: row.name,
      teamName: row.team_name,
    }),

    // The reference leads, whatever order the rows were picked in: this page is about that
    // model, and the comparison reads the first of them as the one the others are against.
    order: (entries) => [
      ...entries.filter((entry) => entry.key === reference.id),
      ...entries.filter((entry) => entry.key !== reference.id),
    ],
  });

  const picking = bindTableSelection(comparison);

  function showSections(ids, shown) {
    for (const id of ids) {
      const section = getSection(id);

      if (section) section.hidden = !shown;
    }
  }

  // Narrows a set of chosen ids to the ones that can actually be compared on the current
  // suite, in the order the reader asked for them, and no more than the comparison holds.
  function pruneSelection(withIds) {
    const allowed = new Set(
      modelsOnSuite(models, reference.id, state.suite)
        .filter((candidate) => candidate.id !== reference.id)
        .map((candidate) => candidate.id),
    );

    return withIds.filter((id) => allowed.has(id)).slice(0, MAX_COMPARATORS);
  }

  // ─── SECTIONS ──────────────────────────────────────────────────────────────

  function renderSuite() {
    const container = getSectionBody("suite");

    container.innerHTML = buildSelect(
      "suite",
      suites.map((suite) => ({ value: suite, label: suite.toUpperCase() })),
      state.suite,
    );

    container
      .querySelector("[data-role='suite']")
      .addEventListener("change", (event) => {
        state.suite = event.target.value;

        // A comparator chosen for the old suite may not have the new one. Pruned here rather
        // than left to the table, so the URL stays honest about what is being compared.
        state.withIds = pruneSelection(state.withIds);

        writeSelection(state);
        renderTitle();
        renderModels();
      });
  }

  // What the reader picks from, and what says what is picked: one row per model scored on
  // the suite, the chosen ones highlighted. It replaced a checkbox picker, so the rows are
  // the comparison's own set rather than a list of names beside it.
  //
  // Rebuilt whenever the suite changes: which models qualify is the suite's answer, and the
  // rows are Tabulator's to hold once given.
  function renderModels() {
    dispose(table);
    comparison.clear();

    const { element, table: instance } = createModelsTable({
      rows: toModelRows(modelsOnSuite(models, reference.id, state.suite)),
      // The page picks the suite above; a second suite select here could only ever empty
      // the table.
      showSuiteFilter: false,
      selection: {
        max: MAX_MODELS,
        onChange: onSelection,
        // The row is the control while picking, so a click on the model's name picks it
        // rather than leaving the page and this comparison with it.
        claimLinks: true,
      },
    });

    table = instance;
    getSectionBody("models").replaceChildren(element);

    // After the build rather than straight away: Tabulator constructs its rows
    // asynchronously, and a selectRow before that has nothing to select. Selecting is what
    // fills the comparison, through the same handler a reader's click goes through.
    table.on("tableBuilt", () => {
      table.selectRow([reference.id, ...state.withIds]);
    });

    picking.attach(table);
  }

  // The reference is picked for the reader rather than pinned there: a reader who takes it
  // out is asking to read two other models against each other on the page they arrived at,
  // which is a fair thing to want. It comes back on the next load, since the URL carries it
  // as the page's own id rather than as one of the comparators.
  function onSelection(rows) {
    comparison.set(rows, state.suite);

    // The comparison refuses a pick past its cap, so the table may be showing a highlight it
    // doesn't hold; this takes it back.
    picking.sync();

    // Written from what the comparison holds rather than from what the table reported, so a
    // refused pick never reaches the URL.
    state.withIds = comparison.keys().filter((key) => key !== reference.id);
    writeSelection(state);
  }

  // ─── START ─────────────────────────────────────────────────────────────────

  function renderTitle() {
    renderHeader(reference.name, getSubtitle(reference, state.suite), [
      buildSuiteBadgeList(suites),
    ]);
  }

  // Nothing chosen, or nothing to show for what was: the controls and the results have
  // nothing to say, so they are hidden rather than left standing empty under their titles.
  function renderIntro(message) {
    dispose(table);
    table = null;
    comparison.clear();

    showSections([...CONTROL_SECTIONS, ...RESULT_SECTIONS], false);
    showSections(["intro"], true);

    renderHtml(getSectionBody("intro"), buildEmptyMessage(message));
  }

  /**
   * The page, once the reference is known — which it is from the moment it loads. The URL's
   * suite and comparators were written against a reference that may since have lost the
   * scores they named, so both are settled here before anything is drawn from them.
   */
  function start() {
    if (!suites.includes(state.suite)) state.suite = suites[0] ?? "";
    state.withIds = pruneSelection(state.withIds);

    writeSelection(state);
    renderTitle();

    if (!suites.length) {
      renderIntro(
        `${reference.name} has no scored tasks yet, so there is nothing to compare.`,
      );

      return;
    }

    showSections(["intro"], false);
    showSections([...CONTROL_SECTIONS, ...RESULT_SECTIONS], true);

    renderSuite();
    renderModels();
  }

  return start();
}

// ─── LOAD ────────────────────────────────────────────────────────────────────

loadPage({
  noun: "model",

  // The page is about one model, so a URL without one is a page that cannot be drawn —
  // loadPage says so in the same words every record page does.
  requiresId: true,

  // A model with a public submission is readable by anyone — see GET /api/models/{id} —
  // and so is the model list this page picks its comparators from.
  requiresAuth: false,

  load: async (id) => {
    // The list as well as the model: `task_suites` is only populated by the list endpoint,
    // and it is what says which models can be compared on a suite.
    const [model, models] = await Promise.all([loadModel(id), getModels()]);

    return model && { model, models: models ?? [] };
  },

  render: renderComparePage,
});
