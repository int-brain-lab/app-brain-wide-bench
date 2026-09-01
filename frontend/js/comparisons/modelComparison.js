// Several models side by side: what they are, and how they scored on one suite.
//
//   summary      one row per model, one column per specification field
//   breakdown    every task on the suite, as a plot or as a grid — models across the top
//   differences  the same again, measured against a baseline the reader picks
//
// The picks, the fetches and the ✕ are comparison.js; this supplies its `render`.

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
  buildRowHeader,
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
import { displayValue } from "../forms/fields.js";
import { SUITES, suiteLabel, suitesFromSubmission } from "../core/suites.js";
import { loadModel } from "../api/modelApi.js";
import { MODEL_FIELDS } from "../schemas/modelSchema.js";
import { fieldsForPanel } from "../schemas/schemaPanels.js";
import { createComparison } from "./comparison.js";
import { buildOptions, buildSelect } from "../components/filters.js";
import {disposeAll} from "../core/disposable.js";


// ─── CONFIGURATION ───────────────────────────────────────────────────────────

// Also the compare page's cap.
const MAX_MODELS = 5;


// ─── SUMMARY ─────────────────────────────────────────────────────────────────

// Null until the model's request lands.
function valueOf(detail, key, fields) {
  if (!detail) return null;

  const value = displayValue(fields[key], detail[key]);

  return value == null || value === "" ? null : String(value);
}

function buildModelHeader(entry) {
  return buildRowHeader({
    key: entry.key,
    title: `
      <a class="label" href="/html/models/models.html?id=${escapeHtml(entry.modelId)}">
        ${escapeHtml(entry.name)}
      </a>`,
    meta: entry.teamName ?? "",
    name: entry.name,
  });
}

function buildSummary(entries, fields, colourOf) {
  const keys = fieldsForPanel(MODEL_FIELDS, "specification", false);

  return buildComparisonGrid({
    columns: keys.map((key) => ({ key, label: fields[key]?.label ?? key })),
    rows: entries.map((entry) => ({
      key: entry.key,
      header: buildModelHeader(entry),
      ink: colourOf(entry.key),
      cells: Object.fromEntries(
        keys.map((key) => [key, { value: valueOf(entry.detail, key, fields) }]),
      ),
    })),
  });
}

// ─── ENTRIES ─────────────────────────────────────────────────────────────────

// For a host whose rows came from toModelRows. The leaderboard's are standings, and it
// passes its own.
function toModelEntry(row) {
  return {
    key: row.id,
    modelId: row.id,
    name: row.name,
    teamName: row.team_name,
  };
}

// ─── SCORES ──────────────────────────────────────────────────────────────────

// What the two score sections are drawn from. The colour is carried on the model rather than
// taken from its place in the list, so a model keeps it when another is dropped — and so the
// grid's column, the bars and the row it was picked from all agree.
//
// `tasks` is derived from the models, and returned with them so that the bars and the rows
// share one axis — and because plots/ cannot reach up here to compute its own.
function scoresForModel(entries, suite, colourOf) {
  const loaded = entries.map((entry) => entry.detail).filter(Boolean);
  const comparedModels = toCompareEntries(
    loaded,
    suite,
    entries[0]?.modelId,
  ).map((entry) => ({ ...entry, colour: colourOf(entry.modelId) }));

  return { comparedModels, tasks: compareTasks(comparedModels) };
}

// The suites the selection has scores on, in SUITES order.
function availableSuites(entries) {
  const scored = new Set(
    entries.flatMap((entry) =>
      (entry.detail?.submissions ?? []).flatMap(suitesFromSubmission),
    ),
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

function buildBaselineSelect() {
  return buildBar("Select baseline model", "baseline", [], "");
}

// ─── WIDGET ──────────────────────────────────────────────────────────────────

/**
 * @param container as createComparison.
 * @param toEntry   (row) => { key, modelId, name, teamName }. `key` identifies the row in
 *                  the host's view; `modelId` is what gets fetched.
 * @param order     as createComparison.
 *
 * A host that passes a suite to `set` owns it; one that passes nothing gets the suite bar
 * below instead.
 */
function createModelComparison({ container, ...options }) {

  // How both score sections are being read.
  let view = PLOT_VIEW;

  let comparison = null;

  // Per section, because the two are now redrawn separately.
  let breakdownCharts = [];
  let differenceCharts = [];

  let selectedBaseline = "";
  let selectedSuite = "";

  // The models being compared on the suite in force, and the tasks they cover. Held rather
  // than recomputed per section: only the picks and the suite move them, and both go through
  // updateScores.
  let comparedModels = [];
  let tasks = [];


  function clearCharts() {
    disposeAll(breakdownCharts);
    disposeAll(differenceCharts);

    breakdownCharts = [];
    differenceCharts = [];
  }

  // Before every render, the empty one included — which is the only reason it hides the
  // sections rather than leaving that to the renderers: with nothing picked the controller
  // writes its prompt and never calls the render, so the last plots would sit under it.
  // Each renderer shows its own section again.
  function clearUp() {
    clearCharts();

    getSection("breakdown").hidden = true;
    getSection("differences").hidden = true;
  }


  // The suite in force: the host's, else the reader's while it is still available, else the
  // first available.
  function getSuite() {
    if (comparison.activeContext) return comparison.activeContext;
    const available = availableSuites(comparison.entries());
    return available.includes(selectedSuite) ? selectedSuite : (available[0] ?? "");
  }


  // The baseline in force, read the same way as the suite: the reader's while it is still
  // among the compared models, else the first of them. Derived rather than written back, so
  // `selectedBaseline` means what the reader chose and nothing else.
  function getBaseline() {
    return comparedModels.some((entry) => entry.modelId === selectedBaseline)
      ? selectedBaseline
      : (comparedModels[0]?.modelId ?? "");
  }

  // After anything that changes which models are compared or which suite they are compared
  // on: the picks, their details arriving, or the reader choosing a suite.
  function updateScores() {
    ({ comparedModels, tasks } = scoresForModel(
      comparison.entries(),
      getSuite(),
      comparison.colourOf,
    ));
  }

  function buildSuiteOptions(availableSuites, selectedSuite) {
    const select = getElement("suite").querySelector(`[data-role='suite']`);
    const options = buildOptions(availableSuites.map((suite) => ({
      value: suite,
      label: suiteLabel(suite)
    })), {selected: selectedSuite});
    renderHtml(select, options);
  }

  // The compared models rather than the picks: a pick with nothing on this suite is not a
  // baseline getBaseline would ever return, so offering it would leave the select showing one
  // model and the differences measured against another.
  function buildBaselineOptions(comparedModels, baseline) {
    const select = getElement("baseline").querySelector(`[data-role='baseline']`);
    const options = buildOptions(comparedModels.map((entry) => ({
      value: entry.modelId,
      label: entry.modelName
    })), {selected: baseline});
    renderHtml(select, options);
  }


  // ─── RENDER ────────────────────────────────────────────────────────────────

  function renderBreakdown() {
    if (!comparedModels.length) {
      getSection("breakdown").hidden = true
      return;
    } else {
      getSection("breakdown").hidden = false;
    }

    const section = getSectionBody("breakdown");

    disposeAll(breakdownCharts);
    breakdownCharts = [];

    if (!tasks.length) {
      renderHtml(section, buildEmptyMessage("No scored tasks on this suite."));

      return;
    }

    // One mode for both halves, so the plot and the grid cannot disagree about a cell.
    const mode = scoreMode();

    if (view === PLOT_VIEW) {
      const plots = createModelPlots({entries: comparedModels, tasks, mode});

      section.replaceChildren(plots.element);
      breakdownCharts = plots.charts;

      return;
    }

    const { element, table } = createCompareTable({
      rows: toCompareRows(comparedModels, tasks, mode),
      tasks,
      mode: "score",
    });

    section.replaceChildren(element);
    breakdownCharts = [table];
  }

  function renderDifferences() {
    if (!comparedModels.length) {
      console.log('here')
      getSection("differences").hidden = true
      return;
    } else if (comparedModels.length === 1) {
      getSection("differences").hidden = false;
      renderHtml(getSectionBody("differences"), buildInfoMessage("Select a second model to see the difference."));
      return;
    } else {
      getSection("differences").hidden = false;
    }


    const section = getSectionBody("differences");

    disposeAll(differenceCharts);
    differenceCharts = [];

    if (!tasks.length || comparedModels.length < 2) {
      renderHtml(
        section,
        buildEmptyMessage("Select a second model to see the difference."),
      );

      return;
    }

    const mode = diffMode(comparedModels, getBaseline());

    if (view === PLOT_VIEW) {
      const plots = createModelPlots({
        entries: comparedModels,
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
      rows: toCompareRows(comparedModels, tasks, mode),
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

    renderHtml(getSectionBody("summary"), buildSummary(comparison.entries(), MODEL_FIELDS, comparison.colourOf));

    setActiveView(view);

    buildSuiteOptions(availableSuites(comparison.entries()), selectedSuite);
    renderBreakdown();

    buildBaselineOptions(comparedModels, getBaseline());
    renderDifferences();
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

    renderDifferences()
    renderBreakdown()
  }


  function attachEvents() {
    getElement(PLOT_VIEW)?.addEventListener("click", () => {
      renderView(PLOT_VIEW)
    });

    getElement(TABLE_VIEW)?.addEventListener("click", () => {
      renderView(TABLE_VIEW)
    });


    getElement("suite").addEventListener("change", (event) => {
      selectedSuite = event.target.value;

      // A different suite is a different set of scored tasks, and a different set of models
      // with a score to show.
      updateScores();

      renderBreakdown();
      renderDifferences();
    });

    getElement("baseline").addEventListener("change", (event) => {
      selectedBaseline = event.target.value;

      renderDifferences();
    });
  }


  function setup() {

    const pageHtml = buildSections([
      {
        id: "summary"
      },
      {
        id: "breakdown",
        title: "Task breakdown",
        actions: [
          buildSuiteSelect(),
          buildPlotTableToggle()],
        hidden: true
      },
      {
        id: "differences",
        title: "Differences",
        actions: [buildBaselineSelect()],
        hidden: true,
      },
    ]);

    renderHtml(container, pageHtml);

    attachEvents();

    comparison = createComparison({
      container: getSectionBody("summary"),
      max: MAX_MODELS,
      prompt: `Select up to ${MAX_MODELS} models to compare them.`,
      palette: SERIES_COLOURS,

      loadDetail: (entry) => loadModel(entry.modelId),

      // The model, not the row: two board rows can name one model.
      cacheKey: (entry) => entry.modelId,

      toEntry: toModelEntry,
      render: renderSections,
      clearUp,

      ...options,
    });

    return comparison;
  }

  // Eagerly, because a host binds its table to the comparison the moment it has one — see
  // bindTableSelection in pages/leaderboard.js.
  return setup();
}

export { MAX_MODELS, createModelComparison };

