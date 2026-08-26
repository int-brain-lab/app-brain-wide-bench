// Several models side by side: what they are, and how they scored on one suite.
//
// What a comparison of models *is* — the cap, the panels, what a model's detail is and how
// to fetch it. Everything else about running one is widgets/comparison.js, which this hands
// itself to; how a host's rows name a model is the host's, as `toEntry`.
//
//   summary      one row per model, one column per specification field
//   breakdown    every task on the suite, as a plot or as a grid — models across the top
//   differences  the same again, measured against a baseline the reader picks
//
// The two score panels each carry their own plot-or-grid toggle: a reader comparing shapes
// in one is often reading numbers off the other. Both wait for every model's detail, because
// until the last one lands "no scored suite" and "not loaded yet" look exactly alike — the
// summary does not, since a row with its values still missing is worth showing.
//
// The model records arrive one request each, on selection: a board row names a model but
// carries none of its specification, and a reader compares a handful, not a hundred.

import { escapeHtml } from "../core/utils.js";
import { PLOT_TABLE_VIEWS } from "../components/viewToggle.js";
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
import { createComparison } from "../widgets/comparison.js";

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

const NO_SUITE = "None of these models has a scored task suite yet.";

// ─── SUMMARY ────────────────────────────────────────────────────────────────

// Absent until the model's own request lands, which reads as "not known yet" rather than
// "not set".
function valueOf(detail, key, fields) {
  if (!detail) return null;

  const value = displayValue(fields[key], detail[key]);

  return value == null || value === "" ? null : String(value);
}

function buildSummary(entries, fields, headerFor) {
  const keys = fieldsForPanel(MODEL_FIELDS, SUMMARY_PANEL, false);

  return buildComparisonGrid({
    columns: keys.map((key) => ({ key, label: fields[key]?.label ?? key })),
    rows: entries.map((entry) => ({
      key: entry.key,
      header: headerFor(entry),
      cells: Object.fromEntries(
        keys.map((key) => [key, { value: valueOf(entry.detail, key, fields) }]),
      ),
    })),
  });
}

// ─── SCORES ─────────────────────────────────────────────────────────────────

// The scores the two lower panels are drawn from. Both need the same two things and neither
// is worth holding onto: it is a handful of models, and it is recomputed only on a render
// that was going to redraw them anyway.
function scoresFor(entries, suite) {
  const loaded = entries.map((entry) => entry.detail).filter(Boolean);
  const compared = toCompareEntries(loaded, suite, entries[0]?.modelId);

  return { entries: compared, tasks: compareTasks(compared) };
}

// The suites the selection has scores on, in the app's own order. Derived rather than
// offered as a fixed three: a suite nobody here has entered is an empty grid and a dead
// option.
function availableSuites(entries) {
  const scored = new Set(
    entries.flatMap((entry) =>
      (entry.detail?.submissions ?? []).flatMap(suitesFromSubmission),
    ),
  );

  return SUITES.filter((suite) => scored.has(suite));
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

// ─── WIDGET ─────────────────────────────────────────────────────────────────

/**
 * @param container as createComparison.
 * @param toEntry   (row) => { key, modelId, name, teamName }. `key` is whatever the host's
 *                  view identifies the row by; `modelId` is what gets fetched, and the two
 *                  differ on the leaderboard, where a row is a standing rather than a model.
 * @param order     as createComparison — the compare page's reference goes first.
 *
 * A score is a fact about a model *on a suite*, so there is always one in force. Which
 * control names it is settled per host: one that passes a context to `set` owns it — the
 * compare page's suite select, the leaderboard's metric select on a suite — and one that
 * passes nothing gets the widget's own select instead, offering the suites the chosen models
 * have actually been scored on. That is the leaderboard on Overall, where the metric select
 * names no suite, and the models list, which has no such control at all.
 */
function createModelComparison(options) {
  // Per comparison rather than per module: which model the differences are measured against
  // is a reader's choice about the models in front of them, not about comparisons of models
  // in general. The panels below close over it, which is why they are built per call.
  let baseline = "";

  // Kept in force where it still exists, so redrawing after a model is added doesn't throw
  // away a choice the reader made — and moved to the first when it doesn't, since the
  // baseline may be the model that just left.
  function settleBaseline(compared) {
    if (!compared.some((entry) => entry.modelId === baseline)) {
      baseline = compared[0]?.modelId ?? "";
    }
  }

  return createComparison({
    max: MAX_MODELS,
    prompt: `Select up to ${MAX_MODELS} models to compare them.`,
    loadingMessage: "Loading scores…",

    loadDetail: (entry) => loadModel(entry.modelId),

    // The model rather than the row: two board rows can name one model, and a reader who
    // unticks and reticks should not pay for it twice.
    cacheKey: (entry) => entry.modelId,

    // Loaded once: the field definitions are the same for every model, and a reader who
    // never compares never pays for them.
    loadFields: loadModelMeta,

    header: (entry) => ({
      title: `
        <a class="label" href="/html/models/models.html?id=${escapeHtml(entry.modelId)}">
          ${escapeHtml(entry.name)}
        </a>`,
      meta: entry.teamName ?? "",
      name: entry.name,
    }),

    context: {
      label: "Task suite",
      options: ({ entries }) =>
        availableSuites(entries).map((suite) => ({
          value: suite,
          label: suite.toUpperCase(),
        })),
    },

    panels: [
      // No heading: the specification is what the reader is looking at when the comparison
      // opens, and a title over the top of it would only name the obvious.
      {
        id: "summary",
        render: ({ container, entries, fields, headerFor }) => {
          container.innerHTML = buildSummary(entries, fields, headerFor);
        },
      },

      {
        id: "breakdown",
        title: "Task breakdown",
        views: PLOT_TABLE_VIEWS,
        defaultView: DEFAULT_VIEW,
        // The suite select sits here rather than at the top, beside the first panel it
        // governs — the summary above it is true whatever the suite.
        controls: true,
        ready: "all",

        available: ({ entries, context }) => {
          if (!context) return NO_SUITE;

          return scoresFor(entries, context).tasks.length
            ? true
            : "No scored tasks on this suite.";
        },

        render: ({ container, entries, context, view }) => {
          const { entries: compared, tasks } = scoresFor(entries, context);

          if (view === "plot") {
            return renderCompareCharts({
              container,
              entries: compared,
              tasks,
              charts: [],
            });
          }

          return renderCompareTable({
            container,
            rows: toScoreRows(compared, tasks),
            models: compareModels(compared),
            mode: "score",
          });
        },
      },

      {
        id: "differences",
        title: "Differences",
        views: PLOT_TABLE_VIEWS,
        defaultView: DEFAULT_VIEW,
        ready: "all",

        // Fewer than two models is nothing to subtract, and no tasks is nothing to subtract
        // it over — either way there is no comparison, and so no baseline to choose and no
        // view to choose between.
        available: ({ entries, context }) => {
          if (!context) return NO_SUITE;

          const { entries: compared, tasks } = scoresFor(entries, context);

          return tasks.length && compared.length >= 2
            ? true
            : "Select a second model to see the difference.";
        },

        // The one panel with a control of its own: which model everything else is measured
        // against. It lives with the grid it shapes rather than in the header, where it would
        // look like it shaped the panel above too.
        render: ({ container, entries, context, view, refresh }) => {
          const { entries: compared, tasks } = scoresFor(entries, context);

          settleBaseline(compared);

          container.innerHTML = buildBaselineBar(compared, baseline);

          // On the select rather than delegated: this container is rewritten on every render
          // of the panel, so the listener goes with the control it belongs to.
          container
            .querySelector("[data-role='baseline']")
            .addEventListener("change", (event) => {
              baseline = event.target.value;

              // Rebuilt rather than refiltered: both the rows and the columns change, since
              // the baseline is the one model the grid doesn't show.
              refresh("differences");
            });

          const body = container.querySelector("[data-role='diff-body']");

          if (view === "plot") {
            return renderDiffCharts({
              container: body,
              entries: compared,
              tasks,
              baselineId: baseline,
              charts: [],
            });
          }

          return renderCompareTable({
            container: body,
            rows: toDiffRows(compared, tasks, baseline),
            models: compareModels(compared, { exclude: baseline }),
            mode: "diff",
          });
        },
      },
    ],

    ...options,
  });
}

export { MAX_MODELS, createModelComparison };
