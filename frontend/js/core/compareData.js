// Shaping for the comparison page: several models' scores on one suite, as a matrix.
//
// scoreData.js collapses one model into a figure per suite; this takes several models and
// keeps the per-task detail, because the whole page is the spread between them. The output
// is deliberately table-shaped — one row per task, one field per model id — so the two
// grids in compareTable.js bind to it with no further reshaping.
//
// Tasks are the rows and models the columns because a suite has many more tasks than a
// comparison has models: eleven columns don't fit and eleven rows are an ordinary table.
// It also makes the metric a property of the row, so filtering by it is a plain row filter.
//
// Two rules the page depends on:
//
//   1. The task rows are the *union* across the models being compared, not the selected
//      model's own tasks. A comparator scoring something the selected model never attempted
//      is worth seeing; it shows as "—" in the selected model's column.
//   2. A model's mean is over the tasks it actually scored, so a model missing two tasks
//      isn't given zeros for them. That makes two means over different task sets, which is
//      why `scored`/`total` travel alongside — the overview shows the coverage.

import { mean } from "./utils.js";
import { suiteFromTask } from "./suites.js";
import { latestScoresByTask } from "./scoreData.js";

// ─── ENTRIES ────────────────────────────────────────────────────────────────

// One model, reduced to its scores on a single suite. `model` is a ModelDetail — the
// GET /api/models/{id} payload, whose submissions carry the task scores.
function toCompareEntry(model, suite) {
  const tasks = Object.fromEntries(
    Object.entries(latestScoresByTask(model.submissions)).filter(
      ([taskId]) => suiteFromTask(taskId) === suite,
    ),
  );

  return {
    modelId: model.id,
    modelName: model.name,
    teamName: model.team_name ?? null,
    // { "ts1-choice": { mean, sem, metric }, … }
    tasks,
    mean: mean(Object.values(tasks).map((task) => task.mean)),
    scored: Object.keys(tasks).length,
  };
}

/**
 * @param models    ModelDetail objects — the selected model and its comparators, in any
 *                  order.
 * @param suite     which suite the page is scoped to.
 * @param selectedId  the model being compared *against*.
 * @returns entries ordered for display: the selected model first, then the rest by mean
 *          descending. A model with no score on the suite sorts last rather than being
 *          dropped — it was explicitly chosen, and silently omitting it would read as a
 *          bug in the picker.
 */
function toCompareEntries(models, suite, selectedId) {
  const entries = models
    .map((model) => toCompareEntry(model, suite))
    .map((entry) => ({ ...entry, isSelected: entry.modelId === selectedId }));

  return entries.sort((a, b) => {
    if (a.isSelected !== b.isSelected) return a.isSelected ? -1 : 1;

    return (b.mean ?? -Infinity) - (a.mean ?? -Infinity);
  });
}

// ─── TASKS ──────────────────────────────────────────────────────────────────

/**
 * The union of scored tasks across `entries`, sorted by id, each with the metric it is
 * measured in.
 *
 * The metric comes from whichever entry scored the task first — it is a property of the
 * task, not of the model, so any of them answers the same. Taken from the scores rather
 * than GET /api/tasks so the page needs no second source of truth for what it is already
 * displaying.
 */
function compareTasks(entries) {
  const metrics = new Map();

  for (const entry of entries) {
    for (const [taskId, task] of Object.entries(entry.tasks)) {
      if (!metrics.has(taskId)) metrics.set(taskId, task.metric);
    }
  }

  return [...metrics]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([taskId, metric]) => ({ taskId, metric }));
}

// For the metric select above each grid. From the tasks on screen, not the Metric enum: an
// option that hides every column would be the only thing it could do.
function compareMetrics(tasks) {
  return [...new Set(tasks.map((task) => task.metric).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
    .map((metric) => ({ value: metric, label: metric }));
}

/**
 * The same entries restricted to one metric: each model's tasks narrowed to the ones
 * measured in it, and its mean and coverage recomputed over what is left. `""` for all of
 * them returns the entries untouched.
 *
 * The grids need nothing like this — a metric is a property of their rows, so they filter
 * — but the overview's bar is a single number derived from all of them, and a mean over
 * eight tasks cannot be narrowed to three after the fact. It has to be taken again.
 */
function entriesForMetric(entries, metric) {
  if (!metric) return entries;

  return entries.map((entry) => {
    const tasks = Object.fromEntries(
      Object.entries(entry.tasks).filter(([, task]) => task.metric === metric),
    );

    return {
      ...entry,
      tasks,
      mean: mean(Object.values(tasks).map((task) => task.mean)),
      scored: Object.keys(tasks).length,
    };
  });
}

// Its counterpart for the task list, so the overview's "3/3 tasks" counts the same set the
// mean beside it was taken over.
function tasksForMetric(tasks, metric) {
  return metric ? tasks.filter((task) => task.metric === metric) : tasks;
}

// ─── COLUMNS ────────────────────────────────────────────────────────────────

/**
 * The models to give a column to, in the order they should appear: the page's own model
 * first, then by mean descending — the order toCompareEntries already put them in.
 *
 * @param exclude  a model id to leave out. For the difference grid, whose baseline is the
 *                 thing every other column is measured against and so has no column of
 *                 its own.
 */
function compareModels(entries, { exclude = null } = {}) {
  return entries
    .filter((entry) => entry.modelId !== exclude)
    .map(({ modelId, modelName, teamName, mean, scored, isSelected }) => ({
      modelId,
      modelName,
      teamName,
      mean,
      scored,
      isSelected,
    }));
}

// ─── ROWS ───────────────────────────────────────────────────────────────────

// Tabulator binds a column to a field name, so each model id becomes a field. The value is
// the whole { mean, sem } object rather than a number — the cell renders both halves, and
// a sorter reading `.mean` is cheaper than carrying a parallel set of fields.
//
// `metric` rides on the row because the metric belongs to the task: it is what the Metric
// column shows and what the select above the grid filters on.
function toScoreRows(entries, tasks) {
  return tasks.map(({ taskId, metric }) => {
    const row = { taskId, metric };

    for (const entry of entries) {
      row[entry.modelId] = entry.tasks[taskId] ?? null;
    }

    return row;
  });
}

/**
 * The difference grid's rows: one per task again, each model's cell holding `{ diff }` —
 * that model's score minus the baseline's on the same task.
 *
 * `baselineId` is whichever model the reader is measuring against, which is the page's own
 * by default but may be any of the compared ones — "how much better is everything than
 * mine?" and "how much better is mine than this one?" are the same grid read two ways.
 *
 * A task only one of the two scored has no difference to state, so the cell is null rather
 * than the raw score. A number in one grid and "—" in the other would read as a gap of
 * exactly that size.
 */
function toDiffRows(entries, tasks, baselineId) {
  const baseline = entries.find((entry) => entry.modelId === baselineId);

  if (!baseline) return [];

  const others = entries.filter((entry) => entry.modelId !== baselineId);

  return tasks.map(({ taskId, metric }) => {
    const row = { taskId, metric };
    const against = baseline.tasks[taskId];

    for (const entry of others) {
      const other = entry.tasks[taskId];

      row[entry.modelId] =
        other && against ? { diff: other.mean - against.mean } : null;
    }

    return row;
  });
}

export {
  toCompareEntries,
  compareTasks,
  compareMetrics,
  entriesForMetric,
  tasksForMetric,
  compareModels,
  toScoreRows,
  toDiffRows,
};
