// How the selected task scores were produced: one row per score, one column per training
// field — see comparisonGrid.js, which is the shape, this being what fills it.
//
// A grid rather than a card each, because the question at four or six scores is not "what
// is this one" but "what is different about them", and that is a question you answer by
// reading down a column.

import { escapeHtml } from "../core/utils.js";
import { getIcon } from "../components/icons.js";
import { buildSuiteBadgeList } from "../components/badges.js";
import { displayValue } from "../forms/fields.js";
import { suiteFromTask } from "../core/suites.js";
import { trainingFieldKeys } from "../schemas/taskSubmissionSchema.js";
import { buildComparisonGrid } from "./comparisonGrid.js";
import { recordingMetricNames } from "./recordingScoreTable.js";

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
    .map(name => `
      <option value="${escapeHtml(name)}" ${name === entry.metric ? "selected" : ""}>
        ${escapeHtml(name)}
      </option>`)
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
      ...keys.map(key => ({ key, label: fields[key]?.label ?? key })),
    ],
    rows: entries.map(entry => ({
      key: entry.key,
      header: buildRowHeader(entry),
      cells: {
        [METRIC]: buildMetricCell(entry),
        ...Object.fromEntries(keys.map(key => [key, { value: valueOf(entry, key, fields) }])),
      },
    })),
  });
}


export { buildMethodologyGrid };
