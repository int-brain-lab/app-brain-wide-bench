// Several task scores side by side: how each was measured, and what it did per recording.
//
// What a comparison of task scores *is*. Running one is widgets/comparison.js; how a host's
// rows name a score is the host's, as `toEntry`.
//
//   methodology  one row per score, one column per training field, the metric first
//   recordings   every recording behind those scores — separate plots, one overlaid plot,
//                or a heatmap
//
// The metric is per score rather than per comparison: two scores of the same task can be
// recorded under different metrics, and the reader picks which one each is drawn in.

import { escapeHtml } from "../core/utils.js";
import { buildSuiteBadgeList } from "../components/badges.js";
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
import { createComparison } from "../widgets/comparison.js";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

// Maximum number of scores that can be compared at once.
const MAX_COMPARED = 6;

const VIEWS = [
  { value: "separate", label: "Separate", icon: "cards" },
  { value: "overlaid", label: "Overlaid", icon: "score" },
  { value: "heatmap", label: "Heatmap", icon: "suite" },
];

// The metric is a column like the others, and the first of them: it is the one the reader
// chooses rather than reads, and it decides what the panel below is drawn in.
const METRIC = "metric";

// ─── ENTRIES ────────────────────────────────────────────────────────────────

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

// ─── METHODOLOGY ────────────────────────────────────────────────────────────

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

function buildMethodologyGrid(entries, fields, headerFor) {
  const keys = trainingFieldKeys();

  return buildComparisonGrid({
    columns: [
      { key: METRIC, label: "Metric" },
      ...keys.map((key) => ({ key, label: fields[key]?.label ?? key })),
    ],
    rows: entries.map((entry) => ({
      key: entry.key,
      header: headerFor(entry),
      cells: {
        [METRIC]: buildMetricCell(entry),
        ...Object.fromEntries(
          keys.map((key) => [key, { value: valueOf(entry, key, fields) }]),
        ),
      },
    })),
  });
}

// ─── WIDGET ─────────────────────────────────────────────────────────────────

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
  return createComparison({
    max: MAX_COMPARED,
    prompt: `Select up to ${MAX_COMPARED} task scores to compare them.`,

    loadDetail: (entry) => loadTaskSubmission(entry.submissionId, entry.key),
    loadFields: loadTaskFields,

    // Which score this row is. The submission sits under the task because two rows of the
    // same task across two models is the comparison this is for.
    header: (entry) => {
      const suite = suiteFromTask(entry.taskId);

      return {
        title: `
          <span class="label">${escapeHtml(entry.taskId)}</span>
          ${suite ? buildSuiteBadgeList([suite], "sm") : ""}`,
        meta: [entry.modelName, entry.submissionLabel].filter(Boolean).join(" · "),
        name: entry.taskId,
      };
    },

    panels: [
      {
        id: "methodology",
        render: ({ container, entries, fields, headerFor, refresh }) => {
          container.innerHTML = buildMethodologyGrid(entries, fields, headerFor);

          // Delegated to this panel's own container, which is rewritten on every render of
          // it, rather than to a root that outlives the selects.
          container.addEventListener("change", (event) => {
            const select = event.target.closest("[data-role='metric']");

            if (!select) return;

            const entry = entries.find((item) => item.key === select.dataset.key);

            if (!entry) return;

            entry.metric = select.value;

            // The plot alone: the grid's own selects are already showing the new value, and
            // redrawing them would take the reader's cursor out of the control they are
            // still working.
            refresh("recordings");
          });
        },
      },

      {
        // No title: the toggle above the plots is the whole of this panel's header, and a
        // heading over a figure the grid above already names would be saying it twice.
        id: "recordings",
        views: VIEWS,

        render: ({ container, entries, view }) => {
          if (view === "heatmap") {
            renderRecordingHeatmaps({
              container,
              entries: entries.map((entry) => toSeriesEntry(entry)),
            });

            return null;
          }

          const overlaid = view === "overlaid";

          return renderRecordingCharts({
            container,
            entries: entries.map((entry, index) =>
              toSeriesEntry(entry, index, { overlaid }),
            ),
            charts: [],
            facet: overlaid ? "metric" : "score",
            size: overlaid ? "tall" : "regular",
          });
        },
      },
    ],

    ...options,
  });
}

export { MAX_COMPARED, createTaskComparison };
