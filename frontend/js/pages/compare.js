// Compare page — a handful of models read against each other.
//
// Two ways in, and the difference between them is whether there is a model the page is about:
//
//   /compare.html?id=<model>   from that model's own page. It is the reference: the page is
//                              titled after it, scoped to a suite it has been scored on, and
//                              offers every other model scored on that suite to read it
//                              against. There is a way back to it.
//   /compare.html?with=<ids>   from the models list, which picked them. There is no reference
//                              and nothing to choose: the table is those models and only
//                              those, every one of them picked, and the page is titled after
//                              what it is rather than after any of them.
//
// The comparison itself is not this page's: it is the same widget the leaderboard mounts under
// its board — the specification grid, the task breakdown and the differences, each as a plot
// or a grid. So this page is only what leads to it:
//
//   suite        which suite, from the ones the reference has been scored on. A reference
//                only — a set brought from the list is scoped by the widget's own suite
//                select instead
//   models       the models on offer, as a table. Picking a row adds it to the comparison
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
import { suiteFromTask, suiteLabel } from "../core/suites.js";
import { sortSuites } from "../tables/formatters.js";
import { latestScoresByTask } from "../comparisons/compareData.js";
import { getModels, loadModel } from "../api/modelApi.js";
import { toModelRows } from "../utils/modelUtils.js";
import { loadPage } from "../templates/page.js";
import { createModelsTable } from "../tables/modelTable.js";
import {
  MAX_MODELS,
  createModelComparison,
} from "../comparisons/modelComparison.js";
import { bindTableSelection } from "../comparisons/comparison.js";
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
const MODEL_LIST_PAGE = "/html/models/model_list_public.html";

const BACK_TEXT = "← Back to model";
const BACK_TO_LIST_TEXT = "← Back to models";

// What the page is called with no model to name it after.
const SET_TITLE = "Compare models";

// `with` rather than `models`: it reads as the sentence the URL is making, and `models` is
// already what the page's own model list is called.
const SUITE_PARAM = "suite";
const WITH_PARAM = "with";

// The table and the comparison under it, so they can be hidden together while there is
// nothing to put in them.
const RESULT_SECTIONS = ["models", "comparison"];
const CONTROL_SECTIONS = ["suite"];

// One short of the widget's own cap while there is a reference, because the reference is one
// of them: the comparison holds MAX_MODELS in total. Without one, all of them are comparators.
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

// The reference, or null for the set entrance. Read here rather than through loadPage, which
// would refuse the page outright for want of an id this one can do without.
function readReferenceId() {
  return new URLSearchParams(location.search).get("id");
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
      text: suite ? `Comparing on ${suiteLabel(suite)}` : null,
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
  // The model the page is about, or null for a set brought from the list. Fixed for the life
  // of the page: it is how the reader arrived, and everything below it — which suites can be
  // chosen, which models the table holds, every score on the page — is read off it.
  const reference = model ?? null;
  const suites = reference ? suitesOf(reference) : [];

  renderPage(
    buildPage({
      back: reference
        ? { text: BACK_TEXT, href: getModelHref(reference) }
        : { text: BACK_TO_LIST_TEXT, href: MODEL_LIST_PAGE },
      header: buildHeader(),

      body:
        // A reference is compared on one suite, chosen here. A set has no one model to derive
        // the choice from, so it is scoped by the widget's own suite select instead and this
        // section never shows.
        (reference ? buildSection({ id: "suite", title: "Task suite" }) : "") +
        // Untitled: it holds whatever is standing in for the page — a reference with nothing
        // scored, or a set whose models have all gone — and a heading over that would be a
        // heading over an apology.
        buildSection({ id: "intro" }) +
        buildSections([
          {
            id: "models",
            title: reference ? "Models on this suite" : "Models compared",
          },
          { id: "comparison", title: "Comparison" },
        ]),
    }),
  );

  // renderPage writes the header's icon placeholders; nothing else on the page calls into
  // lucide until a table or the widget does its own.
  refreshIcons();

  const state = readSelection();

  let table = null;

  // The whole of what was three sections: the specification grid, the task breakdown and
  // the differences, in whichever view the reader last chose. It holds what is picked; the
  // table above is bound to it, so unticking a row there takes it out of the comparison.
  const comparison = createModelComparison({
    container: getSectionBody("comparison"),

    toEntry: (row) => ({
      key: row.id,
      recordId: row.id,
      name: row.name,
      teamName: row.team_name,
    }),

    // The reference leads, whatever order the rows were picked in: this page is about that
    // model, and the comparison reads the first of them as the one the others are against.
    // A set has no such model, so it keeps the order the list picked them in.
    order: reference
      ? (entries) => [
          ...entries.filter((entry) => entry.key === reference.id),
          ...entries.filter((entry) => entry.key !== reference.id),
        ]
      : null,
  });

  const picking = bindTableSelection(comparison);

  function showSections(ids, shown) {
    for (const id of ids) {
      const section = getSection(id);

      if (section) section.hidden = !shown;
    }
  }

  // Every model the table holds: on offer to be read against the reference, or exactly the set
  // the list handed over.
  function offered() {
    if (reference) return modelsOnSuite(models, reference.id, state.suite);

    const wanted = new Set(state.withIds);

    return models.filter((candidate) => wanted.has(candidate.id));
  }

  // Narrows a set of chosen ids to the ones that can actually be compared — on the current
  // suite where there is a reference, and to models that still exist either way — in the order
  // the reader asked for them, and no more than the comparison holds.
  function pruneSelection(withIds) {
    const allowed = new Set(
      offered()
        .filter((candidate) => candidate.id !== reference?.id)
        .map((candidate) => candidate.id),
    );

    return withIds
      .filter((id) => allowed.has(id))
      .slice(0, reference ? MAX_COMPARATORS : MAX_MODELS);
  }

  // ─── SECTIONS ──────────────────────────────────────────────────────────────

  function renderSuite() {
    const container = getSectionBody("suite");

    container.innerHTML = buildSelect(
      "suite",
      suites.map((suite) => ({ value: suite, label: suiteLabel(suite) })),
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
      rows: toModelRows(offered()),
      // The page picks the suite above; a second suite select here could only ever empty
      // the table.
      showSuiteFilter: false,
      // A set is already the models the reader chose, in a table of a handful of rows: there
      // is nothing left to narrow, and a bar of empty controls over five rows reads as a list
      // that failed to load the rest of itself.
      showFilters: Boolean(reference),
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
      table.selectRow([reference?.id, ...state.withIds].filter(Boolean));
    });

    picking.attach(table);
  }

  // The reference is picked for the reader rather than pinned there: a reader who takes it
  // out is asking to read two other models against each other on the page they arrived at,
  // which is a fair thing to want. It comes back on the next load, since the URL carries it
  // as the page's own id rather than as one of the comparators.
  // In the order this page holds them, not the order Tabulator reports: the colours a
  // comparison hands out go by the order picks arrive, and the list that sent the reader here
  // marked its rows in that same order — so a model keeps the colour it was picked in. A row
  // the reader has just added is in neither list and goes last, which is the next colour.
  function inChosenOrder(rows) {
    const rank = new Map(
      [reference?.id, ...state.withIds]
        .filter(Boolean)
        .map((id, at) => [id, at]),
    );

    return [...rows].sort(
      (a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity),
    );
  }

  function onSelection(rows) {
    comparison.set(inChosenOrder(rows), state.suite);

    // The comparison refuses a pick past its cap, so the table may be showing a highlight it
    // doesn't hold; this takes it back.
    picking.sync();

    // Written from what the comparison holds rather than from what the table reported, so a
    // refused pick never reaches the URL. The reference is not one of them: the URL carries it
    // as the page's own id — where there is one at all.
    state.withIds = comparison
      .keys()
      .filter((key) => key !== reference?.id);

    writeSelection(state);
  }

  // ─── START ─────────────────────────────────────────────────────────────────

  // Named after the reference where there is one, and after what the page is where there is
  // not: a set of five models has no one of them to be titled after, and the first of them is
  // not the subject any more than the last is.
  function renderTitle() {
    if (!reference) {
      renderHeader(SET_TITLE, [], []);

      return;
    }

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
   * The page, once what it is about is known — which it is from the moment it loads. The URL's
   * suite and models were written against a field that may since have changed, so both are
   * settled here before anything is drawn from them.
   *
   * The one state neither entrance can be drawn in: nothing to compare. For a reference that
   * is a model with no scored task; for a set it is every model in the URL having gone.
   */
  function start() {
    if (reference && !suites.includes(state.suite)) {
      state.suite = suites[0] ?? "";
    }

    state.withIds = pruneSelection(state.withIds);

    writeSelection(state);
    renderTitle();

    if (reference && !suites.length) {
      renderIntro(
        `${reference.name} has no scored tasks yet, so there is nothing to compare.`,
      );

      return;
    }

    if (!reference && !state.withIds.length) {
      renderIntro(
        "No models to compare. Pick some in the models list and press Compare.",
      );

      return;
    }

    showSections(["intro"], false);
    showSections([...CONTROL_SECTIONS, ...RESULT_SECTIONS], true);

    // A set has no suite section to render into — see the page shell above.
    if (reference) renderSuite();

    renderModels();
  }

  return start();
}

// ─── LOAD ────────────────────────────────────────────────────────────────────

loadPage({
  noun: "model",

  // Not loadPage's id: this page is about one model on one of its two entrances and about a
  // set of them on the other, so a URL with no id is a page that can still be drawn. The
  // reference is read here instead — see readReferenceId.
  requiresId: false,

  // A model with a public submission is readable by anyone — see GET /api/models/{id} —
  // and so is the model list this page picks its comparators from.
  requiresAuth: false,

  load: async () => {
    const referenceId = readReferenceId();

    // The list either way: `task_suites` is only populated by the list endpoint, and it is
    // what says which models can be compared on a suite — and, on the set entrance, the only
    // source for the models the URL names.
    const [model, models] = await Promise.all([
      referenceId ? loadModel(referenceId) : null,
      getModels(),
    ]);

    // A named reference that could not be loaded is a failure; no reference at all is not.
    if (referenceId && !model) return null;

    return { model, models: models ?? [] };
  },

  render: renderComparePage,
});
