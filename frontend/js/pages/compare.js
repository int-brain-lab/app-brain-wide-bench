// Compare page — one model against a handful of others, on one task suite.
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
// The comparison itself is not this page's: it is the same widget the leaderboard and the
// models list mount under their own tables — the specification grid, the task breakdown and
// the differences, each as a plot or a grid. So this page is only what leads to it:
//
//   reference    which model is this about — only when the page wasn't told
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

import { escapeHtml, refreshIcons, showEmpty } from "../core/utils.js";
import { dispose } from "../core/disposable.js";
import { getIcon } from "../components/icons.js";
import { buildSuiteBadgeList } from "../components/badges.js";
import { suiteFromTask } from "../core/suites.js";
import { sortSuites } from "../tables/formatters.js";
import { latestScoresByTask } from "../core/scoreData.js";
import { getModels, loadModel } from "../api/modelApi.js";
import { loadPage } from "../templates/page-loader.js";
import { renderModelsTable } from "../tables/modelTable.js";
import {
  MAX_MODELS,
  createModelComparison,
} from "../widgets/modelComparison.js";
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
const PICK_DESCRIPTION =
  "Pick a reference model, then the others to measure it against.";

// `with` rather than `models`: it reads as the sentence the URL is making, and `models` is
// already what the page's own model list is called.
const SUITE_PARAM = "suite";
const WITH_PARAM = "with";
const REF_PARAM = "ref";

// The table and the comparison under it, so they can be hidden together while there is
// nothing to put in them.
const RESULT_SECTIONS = ["models", "comparison"];
const CONTROL_SECTIONS = ["suite"];

// One short of the widget's own cap, because the reference is the fifth: the comparison
// holds MAX_MODELS in total and this page's reference is always one of them.
const MAX_COMPARATORS = MAX_MODELS - 1;

// ─── URL STATE ───────────────────────────────────────────────────────────────

// Nothing is validated here. Which suites exist depends on the reference, and the reference
// itself may have been deleted since the URL was written. Each is checked by whichever
// renderer knows the answer, and falls back there.
function readSelection() {
  const params = new URLSearchParams(location.search);

  return {
    ref: params.get(REF_PARAM) ?? "",
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
function writeSelection({ ref, suite, withIds }) {
  const params = new URLSearchParams(location.search);

  const entries = {
    [REF_PARAM]: ref,
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

// Only models with something scored: `task_suites` is empty until a submission of theirs
// has a score, and a reference with nothing on it can only produce an apology.
function referenceOptions(models) {
  return models
    .filter((candidate) => candidate.task_suites?.length)
    .map((candidate) => ({
      value: candidate.id,
      // The team disambiguates two models with the same name, which is allowed across
      // teams — the uniqueness rule is per team.
      label: candidate.team_name
        ? `${candidate.name} — ${candidate.team_name}`
        : candidate.name,
    }));
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
 * @param options  [{value, label}].
 * @param selected the value to open on.
 * @param blank    the leading "don't narrow" option's label. Omit for a select that must
 *                 hold one of its options — the suite, which the page is scoped to.
 */
function buildSelect(role, options, selected, blank = null) {
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
    {
      text: suite ? `Comparing on ${suite.toUpperCase()}` : null,
      icon: getIcon("suite"),
    },
  ].filter((entry) => entry.text);
}

// ─── PAGE ────────────────────────────────────────────────────────────────────

function renderComparePage({ model, models, fixedId }) {
  // The reference is fixed by how the reader arrived, or theirs to choose. It is the one
  // thing that decides what the page looks like rather than only what it says.
  const selectable = !fixedId;

  renderPage(
    buildPage({
      // Only one way back, and only when there is somewhere to go back to.
      header: buildHeader(
        model
          ? [
              {
                href: `${MODEL_PAGE}?id=${encodeURIComponent(model.id)}`,
                label: "Back to model",
                icon: getIcon("model"),
              },
            ]
          : [],
      ),

      // The two controls share a row: together they are one question — which model, on
      // which suite. `align-start` because a section may grow a line and .page-section's
      // space-between would otherwise push the other to the bottom of a stretched cell.
      body:
        `<div class="section-row align-start">${buildSections([
          ...(selectable
            ? [{ id: "reference", title: "Reference model" }]
            : []),
          { id: "suite", title: "Task suite" },
        ])}</div>` +
        // Untitled: it holds whatever is standing in for the page — "choose a model" — and
        // a heading over that would be a heading over an apology.
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

  // Whichever model the page is currently about, and the suites it has been scored on.
  // Both change when the reference does, which is why neither is a constant.
  let reference = model ?? null;
  let suites = [];
  let table = null;

  // Seeded with the model already in hand, so a fixed reference is never fetched twice, and
  // held across renders so trying three references pays for each one once. The comparison
  // keeps its own cache of the models it draws — this one is only for the reference, whose
  // scored suites are what the page is built from.
  const details = new Map(model ? [[model.id, Promise.resolve(model)]] : []);

  function detailFor(id) {
    if (!details.has(id)) details.set(id, loadModel(id));

    return details.get(id);
  }

  // The whole of what was three sections: the specification grid, the task breakdown and
  // the differences, in whichever view the reader last chose. A ✕ inside it takes a model
  // out, and the table above is where that selection lives — so the widget hands the key
  // back rather than acting on it.
  const comparison = createModelComparison({
    container: sectionBody("comparison"),
    onDrop: (key) => table?.deselectRow(key),
  });

  function showSections(ids, shown) {
    for (const id of ids) {
      const section = sectionBody(id)?.closest("section");

      if (section) section.hidden = !shown;
    }
  }

  // Narrows a set of chosen ids to the ones that can actually be compared on the current
  // suite, in the order the reader asked for them, and no more than the comparison holds.
  function pruneSelection(withIds) {
    const allowed = new Set(
      modelsOnSuite(models, reference?.id, state.suite)
        .filter((candidate) => candidate.id !== reference?.id)
        .map((candidate) => candidate.id),
    );

    return withIds.filter((id) => allowed.has(id)).slice(0, MAX_COMPARATORS);
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

    container
      .querySelector("[data-role='reference']")
      .addEventListener("change", (event) => {
        useReference(event.target.value);
      });
  }

  function renderSuite() {
    const container = sectionBody("suite");

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

    table = renderModelsTable({
      container: sectionBody("models"),
      models: modelsOnSuite(models, reference.id, state.suite),
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

    // After the build rather than straight away: Tabulator constructs its rows
    // asynchronously, and a selectRow before that has nothing to select. The reference goes
    // in first so it leads the comparison — the widget reads the models in the order they
    // arrive, and this page is about the first of them.
    table.on("tableBuilt", () => {
      table.selectRow([reference.id, ...state.withIds]);
    });
  }

  // The comparison is the table's selection, less the ordering Tabulator happens to hand
  // back: the reference first, then everything else. It is only ever a handful of models,
  // so this is a filter rather than a lookup.
  function toSeeds(rows) {
    const ordered = [
      ...rows.filter((row) => row.id === reference.id),
      ...rows.filter((row) => row.id !== reference.id),
    ];

    return ordered.map((row) => ({
      key: row.id,
      modelId: row.id,
      name: row.name,
      teamName: row.team_name,
    }));
  }

  // The reference is picked for the reader rather than pinned there: a reader who takes it
  // out is asking to read two other models against each other on the page they arrived at,
  // which is a fair thing to want. It comes back on the next load, since the URL carries it
  // as the page's own id rather than as one of the comparators.
  async function onSelection(rows) {
    state.withIds = rows
      .filter((row) => row.id !== reference.id)
      .map((row) => row.id);
    writeSelection(state);

    const overflow = await comparison.show(toSeeds(rows), state.suite);

    // Tabulator caps selection by click but refuses the extra one silently; putting it back
    // is what keeps the highlighted rows and the comparison saying the same thing.
    for (const key of overflow) table?.deselectRow(key);
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

    showEmpty(sectionBody("intro"), message);
  }

  /**
   * Point the page at a model. Everything below the reference depends on it — which suites
   * can be chosen, which models the table holds, every score on the page — so this is the
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
    // whole page. Said once here rather than in each of the sections behind it.
    renderIntro("Loading model…");

    const next = await detailFor(id).catch((error) => {
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
      renderIntro(
        `${next.name} has no scored tasks yet, so there is nothing to compare.`,
      );
      return;
    }

    showSections(["intro"], false);
    showSections([...CONTROL_SECTIONS, ...RESULT_SECTIONS], true);

    renderSuite();
    renderModels();
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
