// Several models side by side: what they are, and how they scored on one suite.
//
//   summary      one row per model, one column per specification field
//   breakdown    every task on the suite, as a plot or as a grid — models across the top
//   differences  the same again, measured against a baseline the reader picks
//
// The picks, the fetches and the ✕ are widgets/comparison.js; this supplies its `render`.

import { escapeHtml } from "../core/html.js";
import {
  buildEmptyMessage,
  buildInfoMessage,
  buildMessageCard,
} from "../components/messages.js";
import { renderHtml } from "../core/render.js";
import { PLOT_TABLE_VIEWS, buildViewToggle } from "../components/viewToggle.js";
import { buildComparisonGrid } from "../tables/comparisonGrid.js";
import { renderCompareTable } from "../tables/compareTable.js";
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
import { buildRowHeader, createComparison } from "../widgets/comparison.js";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

// Also the compare page's cap.
const MAX_MODELS = 5;

const DEFAULT_VIEW = "plot";

// The architecture and pretraining panel in MODEL_FIELDS.
const SUMMARY_PANEL = 3;

// The sections that wait for every detail and carry a toggle.
const SCORE_SECTIONS = ["breakdown", "differences"];

const NO_SUITE = "None of these models has a scored task suite yet.";

// Built once per comparison and written into thereafter.
const LAYOUT = `
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

function slot(root, name) {
  return root.querySelector(`[data-role='${name}']`);
}

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

function buildSummary(entries, fields) {
  const keys = fieldsForPanel(MODEL_FIELDS, SUMMARY_PANEL, false);

  return buildComparisonGrid({
    columns: keys.map((key) => ({ key, label: fields[key]?.label ?? key })),
    rows: entries.map((entry) => ({
      key: entry.key,
      header: buildModelHeader(entry),
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

// What the two score sections are drawn from.
function scoresFor(entries, suite) {
  const loaded = entries.map((entry) => entry.detail).filter(Boolean);
  const compared = toCompareEntries(loaded, suite, entries[0]?.modelId);

  return { entries: compared, tasks: compareTasks(compared) };
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

function buildSuiteBar(available, suite) {
  const options = available
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

function buildBaselineBar(compared, baseline) {
  const options = compared
    .map(
      (entry) => `
      <option value="${escapeHtml(entry.modelId)}" ${entry.modelId === baseline ? "selected" : ""}>
        ${escapeHtml(entry.modelName)}
      </option>`,
    )
    .join("");

  return `
    <div class="column gap-md">
      <span class="row left gap-md">
        <span class="metadata">Measured against</span>
        <span class="inline-select">
          <select class="input-select" data-role="baseline">${options}</select>
        </span>
      </span>
      <div data-role="diff-body"></div>
    </div>`;
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
function createModelComparison(options) {
  // Which way each section is being read.
  const views = { breakdown: DEFAULT_VIEW, differences: DEFAULT_VIEW };

  // Which model the differences are measured against.
  let baseline = "";

  // The reader's suite, used only where the host names none.
  let chosen = "";

  // Fetched once, on the first render. `loadingFields` stops a second request starting.
  let fields = null;
  let loadingFields = null;

  /**
   * The suite in force: the host's, else the reader's while it is still available, else the
   * first available.
   */
  function suiteFor(entries, context) {
    if (context) return context;

    const available = availableSuites(entries);

    return available.includes(chosen) ? chosen : (available[0] ?? "");
  }

  // Kept where it still exists, else the first.
  function settleBaseline(compared) {
    if (!compared.some((entry) => entry.modelId === baseline)) {
      baseline = compared[0]?.modelId ?? "";
    }
  }

  // `active` null takes the toggle away.
  function renderToggle(root, section, active, refresh) {
    const bar = slot(root, `${section}-toggle`);

    bar.innerHTML = active
      ? buildViewToggle({
          views: PLOT_TABLE_VIEWS,
          active,
          // One role per section: both toggles sit under one root.
          role: `model-${section}-view`,
        })
      : "";

    // On the buttons just made, never on `bar`, which survives the render.
    for (const button of bar.querySelectorAll("[data-view]")) {
      button.addEventListener("click", () => {
        if (button.dataset.view === views[section]) return;

        views[section] = button.dataset.view;
        refresh();
      });
    }
  }

  // Nothing where the host names the suite.
  function renderSuiteBar(root, entries, context, refresh) {
    const bar = slot(root, "suite-bar");
    const available = context ? [] : availableSuites(entries);

    bar.innerHTML = available.length
      ? buildSuiteBar(available, suiteFor(entries, context))
      : "";

    bar
      .querySelector("[data-role='suite']")
      ?.addEventListener("change", (event) => {
        chosen = event.target.value;
        refresh();
      });
  }

  function renderBreakdown(root, compared, tasks, refresh, track) {
    const body = slot(root, "breakdown");

    if (!tasks.length) {
      renderToggle(root, "breakdown", null);
      renderHtml(body, buildEmptyMessage("No scored tasks on this suite."));

      return;
    }

    renderToggle(root, "breakdown", views.breakdown, refresh);

    if (views.breakdown === "plot") {
      track(
        renderCompareCharts({
          container: body,
          entries: compared,
          tasks,
          charts: [],
        }),
      );

      return;
    }

    track(
      renderCompareTable({
        container: body,
        rows: toScoreRows(compared, tasks),
        models: compareModels(compared),
        mode: "score",
      }),
    );
  }

  // Carries the baseline select, above the grid it shapes.
  function renderDifferences(root, compared, tasks, refresh, track) {
    const body = slot(root, "differences");

    if (!tasks.length || compared.length < 2) {
      renderToggle(root, "differences", null);
      renderHtml(
        body,
        buildEmptyMessage("Select a second model to see the difference."),
      );

      return;
    }

    renderToggle(root, "differences", views.differences, refresh);
    settleBaseline(compared);

    body.innerHTML = buildBaselineBar(compared, baseline);

    body
      .querySelector("[data-role='baseline']")
      .addEventListener("change", (event) => {
        baseline = event.target.value;

        // Both the rows and the columns change: the baseline is the one model left out.
        refresh();
      });

    const target = body.querySelector("[data-role='diff-body']");

    if (views.differences === "plot") {
      track(
        renderDiffCharts({
          container: target,
          entries: compared,
          tasks,
          baselineId: baseline,
          charts: [],
        }),
      );

      return;
    }

    track(
      renderCompareTable({
        container: target,
        rows: toDiffRows(compared, tasks, baseline),
        models: compareModels(compared, { exclude: baseline }),
        mode: "diff",
      }),
    );
  }

  function render({ root, entries, context, refresh, track }) {
    if (!slot(root, "summary")) root.innerHTML = LAYOUT;

    loadingFields ??= loadModelMeta().then((loaded) => {
      fields = loaded;
      refresh();
    });

    // Only the summary needs the fields.
    slot(root, "summary").innerHTML = fields
      ? buildSummary(entries, fields)
      : buildMessageCard("Loading model fields…");

    // Before the suite: which suites are on offer is read off the models' own scores.
    if (entries.some((entry) => !entry.detail)) {
      for (const section of SCORE_SECTIONS) {
        renderToggle(root, section, null);
        renderHtml(slot(root, section), buildInfoMessage("Loading scores…"));
      }

      return;
    }

    renderSuiteBar(root, entries, context, refresh);

    const suite = suiteFor(entries, context);

    if (!suite) {
      for (const section of SCORE_SECTIONS) {
        renderToggle(root, section, null);
        renderHtml(slot(root, section), buildEmptyMessage(NO_SUITE));
      }

      return;
    }

    const { entries: compared, tasks } = scoresFor(entries, suite);

    renderBreakdown(root, compared, tasks, refresh, track);
    renderDifferences(root, compared, tasks, refresh, track);
  }

  return createComparison({
    max: MAX_MODELS,
    prompt: `Select up to ${MAX_MODELS} models to compare them.`,

    loadDetail: (entry) => loadModel(entry.modelId),

    // The model, not the row: two board rows can name one model.
    cacheKey: (entry) => entry.modelId,

    toEntry: toModelEntry,
    render,

    ...options,
  });
}

export { MAX_MODELS, createModelComparison };
