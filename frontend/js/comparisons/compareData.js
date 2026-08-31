// Shaping for the comparison page: several models' scores on one suite, as a matrix.
//
// The output is table-shaped — one row per task, one field per model id — so the two grids
// in compareTable.js bind to it with no reshaping. Tasks are the rows because a suite has
// many more tasks than a comparison has models, which also makes the metric a property of
// the row and filtering by it a plain row filter.
//
// Four rules the page depends on:
//
//   1. A task's score is the *latest* submitted for it, never the best, and latest per
//      task — the same collapse app/ranking.py does before ranking, which is what lets a
//      rank sit beside a score.
//   2. A missing score is `null`, not `0`, so an unattempted suite doesn't drag a mean down.
//   3. The task rows are the *union* across the models compared, not the selected model's
//      own. A comparator scoring something it never attempted shows as "—" in its column.
//   4. A model's mean is over the tasks it actually scored, so `scored`/`total` travel
//      alongside for the overview's coverage.

import { mean } from "../core/utils.js";
import { suiteFromTask } from "../core/suites.js";

// ─── LATEST ──────────────────────────────────────────────────────────────────

// Each task takes its score from the newest submission that scored it, so a model is read
// as where it currently stands rather than as its most recent upload — the same collapse
// app/ranking.py does before ranking, which is what lets a rank sit beside a score here.
function latestScoresByTask(submissions) {
  const latest = new Map();

  for (const submission of submissions ?? []) {
    // NaN on an absent or unparseable date, which `|| 0` turns into "oldest" — otherwise
    // every comparison against it is false and the task keeps whichever score came first.
    const at = Date.parse(submission.created_at ?? 0) || 0;

    for (const { task_id, score } of submission.task_submissions ?? []) {
      if (score?.primary_metric_mean == null) continue;

      const held = latest.get(task_id);

      if (held && held.at >= at) continue;

      latest.set(task_id, {
        at,
        mean: score.primary_metric_mean,
        // Nullable on a scored task too — a single-seed run has a mean but no spread.
        sem: score.primary_metric_sem ?? null,
        metric: score.primary_metric ?? null,
      });
    }
  }

  return Object.fromEntries(
    [...latest].map(([taskId, { mean, sem, metric }]) => [
      taskId,
      { mean, sem, metric },
    ]),
  );
}

// ─── ENTRIES ─────────────────────────────────────────────────────────────────

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

// ─── TASKS ───────────────────────────────────────────────────────────────────

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

// ─── COLUMNS ─────────────────────────────────────────────────────────────────

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

// ─── ROWS ────────────────────────────────────────────────────────────────────

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
  latestScoresByTask,
  toCompareEntries,
  compareTasks,
  compareModels,
  toScoreRows,
  toDiffRows,
};
