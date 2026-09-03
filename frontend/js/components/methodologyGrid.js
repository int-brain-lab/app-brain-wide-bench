// The columns a methodology grid shows, and the cells under them.
//
// Only how a score was produced — the five training fields, and nothing about the numbers
// themselves. The metric belongs to the reading rather than to the methodology, and it is one
// choice for a whole comparison rather than one per score, so it lives on the control that
// applies it: see buildMetricSelect in comparisons/taskScoreComparison.js.
//
// Shared with methodologyLines below, so a grid and a tooltip cannot disagree about which
// fields methodology means, in what order, or under what names. The grid itself is
// components/comparisonGrid.js.

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
    trainingFieldKeys().map((key) => [
      key,
      { value: fieldText(record, fields, key) },
    ]),
  );
}

/**
 * The same fields as labelled lines, for somewhere with no columns to put them in — a plot's
 * tooltip. Only the ones the record answers, so a record that says nothing about how it was
 * produced adds nothing rather than a run of dashes.
 *
 * @param record as methodologyCells. A score shape that carries no methodology at all — a
 *               leaderboard row's, a difference — yields an empty list.
 * @param fields as methodologyCells.
 * @returns ["Training paradigm: …", …].
 */
function methodologyLines(record, fields) {
  return trainingFieldKeys()
    .map((key) => [fields[key]?.label ?? key, fieldText(record, fields, key)])
    .filter(([, value]) => value != null)
    .map(([label, value]) => `${label}: ${value}`);
}

export { methodologyCells, methodologyColumns, methodologyLines };
