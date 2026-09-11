// The rows a record comparison's details grid ends with, and the cells under them.
//
// Only how a score was produced — the five training fields, and nothing about the numbers
// themselves. The metric is one choice for a whole comparison rather than one per score, so
// it lives on the control that applies it — see buildMetricBadges in taskScoreComparison.js.
//
// The grid itself is components/comparisonGrid.js.

import { displayValue } from "../forms/fields.js";
import { trainingFieldKeys } from "../schemas/taskSubmissionSchema.js";

/**
 * @param fields TASK_FIELDS, for the labels.
 * @returns the columns for buildComparisonGrid.
 */
function methodologyColumns(fields) {
  return trainingFieldKeys().map((key) => ({
    key,
    label: fields[key]?.label ?? key,
  }));
}

// One field of a record as it should read, or null for one it says nothing about — an empty
// string included, which is "not set" written a second way.
function fieldText(record, fields, key) {
  const value = record ? displayValue(fields[key], record[key]) : null;

  return value == null || value === "" ? null : String(value);
}

/**
 * @param record whatever holds the five methodology fields — a task submission detail, or a
 *               task off a model breakdown. Null for a row whose own request hasn't landed,
 *               which reads as "not known yet" rather than "not set".
 * @param fields TASK_FIELDS, for how each value is written.
 * @returns the cells for one row of buildComparisonGrid.
 */
function methodologyCells({ record, fields }) {
  return Object.fromEntries(
    trainingFieldKeys().map((key) => [key, { value: fieldText(record, fields, key) }]),
  );
}

export { methodologyCells, methodologyColumns };
