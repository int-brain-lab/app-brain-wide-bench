// A task score's breakdown, as the panels read it.
//
// `score.metrics` is written by the scorers in app/scoring: `recordings`, one entry per
// (label, task, recording), each carrying `{metric: {mean, sem, n}}`; and `overall`, the
// same pair per metric taken over seeds. Scores written before `overall` existed lack it.

import { MACRO_REGION, REGION_SEPARATOR } from "../core/suites.js";
import { mean, sem } from "../core/utils.js";

const REGION_TASK_TYPE = "brain_region";

function splitMetric(name) {
  const at = name.indexOf(REGION_SEPARATOR);

  return [name.slice(0, at), name.slice(at + 1)];
}

// `[category key, metric name, stats]` for every measurement. A brain-region score has no
// recording of its own; its metric names carry the region instead.
function toCells(recordings, taskType) {
  const cells = [];

  for (const recording of recordings) {
    for (const [name, stats] of Object.entries(recording.metrics ?? {})) {
      if (taskType === REGION_TASK_TYPE) {
        const [region, metric] = splitMetric(name);

        cells.push([region, metric, stats]);
      } else {
        cells.push([recording.recording_id ?? null, name, stats]);
      }
    }
  }

  return cells;
}

// Each metric's mean over seeds, with the spread of it, as `metrics.overall` records it.
function toMeans(overall) {
  return Object.fromEntries(
    Object.entries(overall).map(([name, stats]) => [name, { mean: stats.mean, sem: stats.sem }]),
  );
}

// A region task's `metrics` are keyed by the metric alone, while `overall` keeps the region
// on the name. The macro average is the entry the task's primary metric names.
function toRegionMeans(overall, metrics) {
  return Object.fromEntries(
    Object.keys(metrics).map((name) => {
      const stats = overall[`${MACRO_REGION}${REGION_SEPARATOR}${name}`];

      return [name, { mean: stats?.mean ?? null, sem: stats?.sem ?? null }];
    }),
  );
}

// Each metric's mean over its categories, with the spread of it — read for a score written
// before `overall` existed.
//
// TODO: remove this, its call in meansFor, and the `mean`/`sem` imports once every
// task_scores row carries `metrics.overall`.
function toLegacyMeans(metrics) {
  return Object.fromEntries(
    Object.entries(metrics).map(([name, columns]) => {
      const values = columns.mean.filter((value) => value != null);

      return [name, { mean: mean(values), sem: sem(values) }];
    }),
  );
}

// The `{ mean, sem }` per metric appropriate to what the score carries.
function meansFor(score, taskType, metrics) {
  const overall = score?.metrics?.overall;

  if (!overall) return toLegacyMeans(metrics);

  return taskType === REGION_TASK_TYPE ? toRegionMeans(overall, metrics) : toMeans(overall);
}

/**
 * A fetched task submission, with its breakdown turned column-wise.
 *
 * @param detail   from loadTaskSubmission. Its own fields ride along, for the methodology
 *                 grid to read. `score` does not: it holds the same numbers this transposes.
 * @param taskType what the score's numbers mean — see taskTypeOf.
 * @returns the detail, plus `taskType`, `index` as category key => position, `metrics` as
 *          `{ [name]: { mean, sem } }` — each array `index.size` long, and null where a
 *          category lacks that metric — and `means`, one `{ mean, sem }` per metric, taken
 *          over seeds from `overall`, or over the categories for a score written without it.
 */
function toScoreDetail(detail, taskType) {
  const { score, ...rest } = detail ?? {};
  const cells = toCells(score?.metrics?.recordings ?? [], taskType);

  const index = new Map();
  const metrics = {};

  for (const [key] of cells) {
    if (!index.has(key)) index.set(key, index.size);
  }

  for (const [, name] of cells) {
    metrics[name] ??= {
      mean: Array(index.size).fill(null),
      sem: Array(index.size).fill(null),
    };
  }

  for (const [key, name, stats] of cells) {
    const at = index.get(key);

    metrics[name].mean[at] = stats?.mean ?? null;
    metrics[name].sem[at] = stats?.sem ?? null;
  }

  return { ...rest, taskType, index, metrics, means: meansFor(score, taskType, metrics) };
}

export { REGION_TASK_TYPE, toScoreDetail };
