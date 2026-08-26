// Compare several task scores side by side.
//
// The host owns selection. This component owns everything after selection:
// loading score details, showing methodology, and rendering the recording
// breakdown as separate charts, an overlaid chart, or a heatmap.

import { refreshIcons, showEmpty } from "../core/utils.js";
import { buildViewToggle, viewFromClick } from "../components/viewToggle.js";
import { resolveContainer } from "../tables/table.js";
import {
  renderRecordingCharts,
  renderRecordingHeatmaps,
} from "../charts/recordingChart.js";
import { SERIES_INK, seriesStyle } from "../charts/palette.js";
import { loadTaskSubmission } from "../api/taskSubmissionApi.js";
import { loadTaskFields } from "../schemas/taskSubmissionSchema.js";
import { escapeHtml } from "../core/utils.js";
import { getIcon } from "../components/icons.js";
import { buildSuiteBadgeList } from "../components/badges.js";
import { displayValue } from "../forms/fields.js";
import { suiteFromTask } from "../core/suites.js";
import { trainingFieldKeys } from "../schemas/taskSubmissionSchema.js";
import { buildComparisonGrid } from "../tables/comparisonGrid.js";
import { recordingMetricNames } from "../tables/recordingScoreTable.js";

// Maximum number of scores that can be compared at once.
const MAX_COMPARED = 6;

const VIEWS = [
  { value: "separate", label: "Separate", icon: "cards" },
  { value: "overlaid", label: "Overlaid", icon: "score" },
  { value: "heatmap", label: "Heatmap", icon: "suite" },
];

// What the widget says with nothing selected. A default rather than a constant the host
// must restate: the leaderboard's rows are one task's scores across models, so it says
// "rows" where the scores page says "task scores" — the same instruction about the same
// cap, in the words of whatever table is above it.
const PROMPT = `Select up to ${MAX_COMPARED} task scores to compare them.`;

// The metric is a column like the others, and the first of them: it is the one the reader
// chooses rather than reads, and it decides what the panel below is drawn in.
const METRIC = "metric";

// Which score this row is, and the way to drop it. The submission sits under the task
// because two rows of the same task across two models is the comparison this is for.
function buildRowHeader(entry) {
  const suite = suiteFromTask(entry.taskId);

  return `
    <span class="column gap-xs">
      <span class="row left gap-sm">
        <button
          type="button"
          class="chip-remove"
          data-role="drop"
          data-key="${escapeHtml(entry.key)}"
          title="Remove ${escapeHtml(entry.taskId)}"
          aria-label="Remove ${escapeHtml(entry.taskId)}"
        >
          <i class="field-icon" data-lucide="${escapeHtml(getIcon("remove"))}"></i>
        </button>
        <span class="label">${escapeHtml(entry.taskId)}</span>
        ${suite ? buildSuiteBadgeList([suite], "sm") : ""}
      </span>
      <span class="metadata">${escapeHtml(
        [entry.modelName, entry.submissionLabel].filter(Boolean).join(" · "),
      )}</span>
    </span>`;
}

// The one cell that is a control rather than a reading: which metric this score's panel is
// drawn in. Its value is the metric, so the column still mutes when they all agree.
function buildMetricCell(entry) {
  const options = recordingMetricNames(entry.recordings)
    .map(
      (name) => `
      <option value="${escapeHtml(name)}" ${name === entry.metric ? "selected" : ""}>
        ${escapeHtml(name)}
      </option>`,
    )
    .join("");

  return {
    value: entry.metric ?? "",
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

/**
 * @param entries [{ key, taskId, submissionLabel, modelName, metric, recordings, detail }]
 * @param fields  the task-submission field definitions, from loadTaskFields.
 */
function buildMethodologyGrid(entries, fields) {
  const keys = trainingFieldKeys();

  return buildComparisonGrid({
    columns: [
      { key: METRIC, label: "Metric" },
      ...keys.map((key) => ({ key, label: fields[key]?.label ?? key })),
    ],
    rows: entries.map((entry) => ({
      key: entry.key,
      header: buildRowHeader(entry),
      cells: {
        [METRIC]: buildMetricCell(entry),
        ...Object.fromEntries(
          keys.map((key) => [key, { value: valueOf(entry, key, fields) }]),
        ),
      },
    })),
  });
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function defaultMetric(metric, recordings) {
  const names = recordingMetricNames(recordings);

  if (!names.length || names.includes(metric)) {
    return metric;
  }

  return names[0];
}

function toSeriesEntry(entry, index, { overlaid = false } = {}) {
  return {
    key: entry.key,
    ...(overlaid ? seriesStyle(index) : { colour: SERIES_INK }),
    label: `${entry.modelName ?? entry.submissionLabel ?? ""} · ${entry.taskId}`,
    metric: entry.metric,
    recordings: entry.recordings,
  };
}

// ─── WIDGET ──────────────────────────────────────────────────────────────────

/**
 * Create a task-score comparison widget.
 *
 * @param {HTMLElement|string} container
 * @param {(key: string) => void} onDrop Called when a score is removed.
 *
 * @returns {{
 *   show: (seeds: Array) => Promise<string[]>,
 *   clear: () => void
 * }}
 */
function createTaskComparison({ container, onDrop = () => {} }) {
  const root = resolveContainer(container, "createTaskComparison");

  let entries = [];
  let charts = [];
  let fields = null;
  let view = "separate";

  // ─── Rendering ────────────────────────────────────────────────────────────

  function clearCharts() {
    charts.forEach((chart) => chart?.destroy?.());
    charts = [];
  }

  function ensureLayout() {
    if (root.querySelector("[data-role='grid']")) return;

    root.innerHTML = `
      <div data-role="grid"></div>
      <div data-role="plot"></div>
    `;
  }

  function renderGrid() {
    const grid = root.querySelector("[data-role='grid']");

    grid.innerHTML =
      buildMethodologyGrid(entries, fields) +
      buildViewToggle({
        views: VIEWS,
        active: view,
        role: "compare-view",
      });

    refreshIcons();
  }

  function renderPlot() {
    const plot = root.querySelector("[data-role='plot']");

    if (view === "heatmap") {
      clearCharts();

      renderRecordingHeatmaps({
        container: plot,
        entries: entries.map((entry) => toSeriesEntry(entry)),
      });

      return;
    }

    const overlaid = view === "overlaid";

    charts = renderRecordingCharts({
      container: plot,
      entries: entries.map((entry, index) =>
        toSeriesEntry(entry, index, { overlaid }),
      ),
      charts,
      facet: overlaid ? "metric" : "score",
      size: overlaid ? "tall" : "regular",
    });
  }

  function render() {
    if (!entries.length) {
      clearCharts();
      showEmpty(root, PROMPT);
      return;
    }

    ensureLayout();
    renderGrid();
    renderPlot();
  }

  // ─── Data ─────────────────────────────────────────────────────────────────

  async function loadDetail(entry) {
    try {
      const detail = await loadTaskSubmission(entry.submissionId, entry.key);

      entry.detail = detail;
      entry.recordings = detail.score?.metrics?.recordings ?? [];
      entry.metric = defaultMetric(entry.metric, entry.recordings);
    } catch (error) {
      console.error(error);
      entry.detail = {};
    }

    // The entry may have been removed while the request was in flight.
    if (entries.includes(entry)) {
      render();
    }
  }

  async function show(seeds) {
    const keys = new Set(seeds.map((seed) => seed.key));
    const overflow = [];

    // Remove scores that are no longer selected.
    entries = entries.filter((entry) => keys.has(entry.key));

    if (seeds.length && !fields) {
      fields = await loadTaskFields();
    }

    for (const seed of seeds) {
      if (entries.some((entry) => entry.key === seed.key)) {
        continue;
      }

      if (entries.length >= MAX_COMPARED) {
        overflow.push(seed.key);
        continue;
      }

      const entry = {
        ...seed,
        recordings: [],
        detail: null,
      };

      entries.push(entry);
      loadDetail(entry);
    }

    render();

    return overflow;
  }

  function clear() {
    clearCharts();
    entries = [];
    showEmpty(root, prompt);
  }

  // ─── Events ───────────────────────────────────────────────────────────────

  root.addEventListener("change", (event) => {
    const select = event.target.closest("[data-role='metric']");

    if (!select) return;

    const entry = entries.find((item) => item.key === select.dataset.key);

    if (!entry) return;

    entry.metric = select.value;
    renderPlot();
  });

  root.addEventListener("click", (event) => {
    const drop = event.target.closest("[data-role='drop']");

    if (drop) {
      onDrop(drop.dataset.key);
      return;
    }

    const chosen = viewFromClick(event, "compare-view");

    if (!chosen || chosen === view) return;

    view = chosen;
    renderGrid();
    renderPlot();
  });

  clear();

  return { show, clear };
}

export { MAX_COMPARED, createTaskComparison };
