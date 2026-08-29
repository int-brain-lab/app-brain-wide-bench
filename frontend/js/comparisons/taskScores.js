// Several task scores side by side: how each was measured, and what it did per recording.
//
//   methodology  one row per score, one column per training field, the metric first
//   recordings   every recording behind those scores — separate plots, one overlaid plot,
//                or a heatmap
//
// The picks, the fetches and the ✕ are widgets/comparison.js, which this hands a `render`
// to; how a host's rows name a score is the host's, as `toEntry`.
//
// The metric is per score rather than per comparison: two scores of the same task can be
// recorded under different metrics, and the reader picks which one each is drawn in.

import { escapeHtml } from "../core/html.js";
import { buildMessageCard } from "../components/messages.js";
import { buildSuiteBadgeList } from "../components/badges.js";
import { buildViewToggle } from "../components/viewToggle.js";
import { buildComparisonGrid } from "../tables/comparisonGrid.js";
import {
  renderRecordingCharts,
  renderRecordingHeatmaps,
} from "../charts/recordingChart.js";
import { SERIES_INK, seriesStyle } from "../charts/palette.js";
import { loadTaskSubmission } from "../api/taskSubmissionApi.js";
import {
  loadTaskFields,
  trainingFieldKeys,
} from "../schemas/taskSubmissionSchema.js";
import { displayValue } from "../forms/fields.js";
import { suiteFromTask } from "../core/suites.js";
import { recordingMetricNames } from "../tables/recordingScoreTable.js";
import { buildRowHeader, createComparison } from "../widgets/comparison.js";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

// Maximum number of scores that can be compared at once.
const MAX_COMPARED = 6;

const VIEWS = [
  { value: "separate", label: "Separate", icon: "cards" },
  { value: "overlaid", label: "Overlaid", icon: "score" },
  { value: "heatmap", label: "Heatmap", icon: "suite" },
];

const VIEW_ROLE = "task-compare-view";

// The metric is a column like the others, and the first of them: it is the one the reader
// chooses rather than reads, and it decides what the panel below is drawn in.
const METRIC = "metric";

// The grid, the toggle under it, and the plots under that. Built once per comparison.
const LAYOUT = `
  <div data-role="grid"></div>
  <div data-role="plot"></div>`;

function slot(root, name) {
  return root.querySelector(`[data-role='${name}']`);
}

// ─── ENTRIES ─────────────────────────────────────────────────────────────────

// Read off the detail rather than stamped onto the entry when it lands: a score unticked and
// reticked is a new entry answered from the cache, which never runs the fetch again.
function recordingsOf(entry) {
  return entry.detail?.score?.metrics?.recordings ?? [];
}

// The reader's choice where they have made one and it still exists, the row's own metric
// otherwise, and the first recorded one where neither holds.
function metricOf(entry) {
  const names = recordingMetricNames(recordingsOf(entry));

  if (!names.length || names.includes(entry.metric)) return entry.metric;

  return names[0];
}

function toSeriesEntry(entry, index, { overlaid = false } = {}) {
  return {
    key: entry.key,
    ...(overlaid ? seriesStyle(index) : { colour: SERIES_INK }),
    label: `${entry.modelName ?? entry.submissionLabel ?? ""} · ${entry.taskId}`,
    metric: metricOf(entry),
    recordings: recordingsOf(entry),
  };
}

// ─── METHODOLOGY ─────────────────────────────────────────────────────────────

// The one cell that is a control rather than a reading: which metric this score's panel is
// drawn in. Its value is the metric, so the column still mutes when they all agree.
function buildMetricCell(entry) {
  const metric = metricOf(entry);

  const options = recordingMetricNames(recordingsOf(entry))
    .map(
      (name) => `
      <option value="${escapeHtml(name)}" ${name === metric ? "selected" : ""}>
        ${escapeHtml(name)}
      </option>`,
    )
    .join("");

  return {
    value: metric ?? "",
    html: `
      <select class="input-select" data-role="metric" data-key="${escapeHtml(entry.key)}">
        ${options}
      </select>`,
  };
}

// A value the reader can compare, or nothing. `detail` is absent until each score's own
// request lands, which reads as "not known yet" rather than "not set".
function valueOf(entry, key, fields) {
  if (!entry.detail) return null;

  const value = displayValue(fields[key], entry.detail[key]);

  return value == null || value === "" ? null : String(value);
}

// Which score this row is. The submission sits under the task because two rows of the same
// task across two models is the comparison this is for.
function buildScoreHeader(entry) {
  const suite = suiteFromTask(entry.taskId);

  return buildRowHeader({
    key: entry.key,
    title: `
      <span class="label">${escapeHtml(entry.taskId)}</span>
      ${suite ? buildSuiteBadgeList([suite], "sm") : ""}`,
    meta: [entry.modelName, entry.submissionLabel].filter(Boolean).join(" · "),
    name: entry.taskId,
  });
}

function buildMethodologyGrid(entries, fields) {
  const keys = trainingFieldKeys();

  return buildComparisonGrid({
    columns: [
      { key: METRIC, label: "Metric" },
      ...keys.map((key) => ({ key, label: entries[key]?.label ?? key })),
    ],
    rows: entries.map((entry) => ({
      key: entry.key,
      header: buildScoreHeader(entry),
      cells: {
        [METRIC]: buildMetricCell(entry),
        ...Object.fromEntries(
          keys.map((key) => [key, { value: valueOf(entry, key, fields) }]),
        ),
      },
    })),
  });
}

// ─── WIDGET ──────────────────────────────────────────────────────────────────

/**
 * @param container as createComparison.
 * @param toEntry   (row) => { key, taskId, submissionId, submissionLabel, modelName, metric }.
 *                  `key` is the task submission the score belongs to, which is also what is
 *                  fetched.
 * @param prompt    what to say with nothing picked. The leaderboard's rows are one task's
 *                  scores across models, so it says "rows" where the scores page says "task
 *                  scores" — the same instruction about the same cap, in the words of
 *                  whatever table is above it.
 */
function createTaskComparison(options) {
  // Which of the three ways the recordings are being read. Per comparison, and sticky: a
  // reader who overlaid one set wants the next overlaid too.
  let view = "separate";

  // The training fields every score is described by. The same for all of them, so they are
  // fetched once — and on the first render rather than here, so a reader who never compares
  // never pays for them. `loadingFields` is what stops a second render starting a second
  // request while the first is still in the air.
  let fields = null;
  let loadingFields = null;

  // The grid, and the two controls that live in it: a metric per score, and the toggle for
  // the plots below. Both listeners go on elements this render just made — the grid itself
  // survives every render and would collect one per redraw.
  function renderGrid(root, entries, refresh) {
    const grid = slot(root, "grid");

    // The toggle is drawn either way: which way the plots below are read has nothing to do
    // with the fields, and taking the control away while they land would be a flicker.
    grid.innerHTML =
      (fields
        ? buildMethodologyGrid(entries, fields)
        : buildMessageCard("Loading methodology…")) +
      buildViewToggle({ views: VIEWS, active: view, role: VIEW_ROLE });

    for (const select of grid.querySelectorAll("[data-role='metric']")) {
      select.addEventListener("change", () => {
        const entry = entries.find((item) => item.key === select.dataset.key);

        if (!entry) return;

        entry.metric = select.value;
        refresh();
      });
    }

    for (const button of grid.querySelectorAll("[data-view]")) {
      button.addEventListener("click", () => {
        if (button.dataset.view === view) return;

        view = button.dataset.view;
        refresh();
      });
    }
  }

  function renderPlot(root, entries, track) {
    const plot = slot(root, "plot");

    if (view === "heatmap") {
      renderRecordingHeatmaps({
        container: plot,
        entries: entries.map((entry) => toSeriesEntry(entry)),
      });

      return;
    }

    const overlaid = view === "overlaid";

    track(
      renderRecordingCharts({
        container: plot,
        entries: entries.map((entry, index) =>
          toSeriesEntry(entry, index, { overlaid }),
        ),
        charts: [],
        facet: overlaid ? "metric" : "score",
        size: overlaid ? "tall" : "regular",
      }),
    );
  }

  function render({ root, entries, refresh, track }) {
    if (!slot(root, "grid")) root.innerHTML = LAYOUT;

    loadingFields ??= loadTaskFields().then((loaded) => {
      fields = loaded;
      refresh();
    });

    // Drawn as each score arrives rather than held until they all have: a row with its
    // methodology still missing is worth showing, and its plot fills in behind it. The
    // plots don't wait on the fields either — nothing in them is described by one.
    renderGrid(root, entries, refresh);
    renderPlot(root, entries, track);
  }

  return createComparison({
    max: MAX_COMPARED,
    prompt: `Select up to ${MAX_COMPARED} task scores to compare them.`,

    loadDetail: (entry) => loadTaskSubmission(entry.submissionId, entry.key),

    render,

    ...options,
  });
}

export { MAX_COMPARED, createTaskComparison };
