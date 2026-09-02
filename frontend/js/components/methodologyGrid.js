// The columns a methodology grid shows, and the cells under them.
//
// Two views draw this: the task-score comparison, where a row is one score and the metric
// cell is a control choosing which metric to draw it in, and the model breakdown, where a
// row is one of a model's tasks and the metric is a reading like the rest. Only the columns
// and the cell mapping are shared — the row headers and the metric cell belong to whichever
// view is asking, because they are what differs.
//
// Shared so the two cannot disagree about which fields methodology means, in what order, or
// under what names. The grid itself is components/comparisonGrid.js.

import { displayValue } from "../forms/fields.js";
import { trainingFieldKeys } from "../schemas/taskSubmissionSchema.js";

// The metric column's key. Not a field of TASK_FIELDS — the metric is on the score, not on
// the entry — so it needs a name of its own that no field can collide with.
const METRIC = "metric";

/**
 * @param fields TASK_FIELDS, for the labels.
 * @returns the columns for buildComparisonGrid, the metric first: it is what the numbers
 *          under it are in, so it is read before anything about how they were produced.
 */
function methodologyColumns(fields) {
  return [
    { key: METRIC, label: "Metric" },
    ...trainingFieldKeys().map((key) => ({
      key,
      label: fields[key]?.label ?? key,
    })),
  ];
}

/**
 * @param record     whatever holds the five methodology fields — a task submission detail,
 *                   or a task off a model breakdown. Null for a row whose own request
 *                   hasn't landed, which reads as "not known yet" rather than "not set".
 * @param fields     TASK_FIELDS, for how each value is written.
 * @param metricCell the metric column's cell, as `{ value, html? }`.
 * @returns the cells for one row of buildComparisonGrid.
 */
function methodologyCells({ record, fields, metricCell }) {
  return {
    [METRIC]: metricCell,
    ...Object.fromEntries(
      trainingFieldKeys().map((key) => {
        if (!record) return [key, { value: null }];

        const value = displayValue(fields[key], record[key]);

        return [key, { value: value == null || value === "" ? null : String(value) }];
      }),
    ),
  };
}

export { METRIC, methodologyCells, methodologyColumns };
