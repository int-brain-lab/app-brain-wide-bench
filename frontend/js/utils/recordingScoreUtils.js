// A task score's breakdown, as the panels read it.
//
// `score.metrics.recordings` is written by the scorers in app/scoring: one entry per
// (label, task, recording), each carrying `{metric: {mean, sem, n}}`.

import { mean, sem } from "../core/utils.js";

// ts3 names its metrics `<brain region>/<metric>` — "TH/f1-score", "macro/precision".
const REGION_SEPARATOR = "/";
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

// Each metric's mean over its categories, with the spread of it. Here rather than at the
// panel, so it is done once per fetch.
function toMeans(metrics) {
  return Object.fromEntries(
    Object.entries(metrics).map(([name, columns]) => {
      const values = columns.mean.filter((value) => value != null);

      return [name, { mean: mean(values), sem: sem(values) }];
    }),
  );
}

/**
 * A fetched task submission, with its breakdown turned column-wise.
 *
 * @param detail   from loadTaskSubmission. Its own fields ride along, for the methodology
 *                 grid to read. `score` does not: it holds the same numbers this transposes.
 * @param taskType what the score's numbers mean — see taskTypeOf.
 * @returns the detail, plus `taskType`, `index` as category key => position, `metrics` as
 *          `{ [name]: { mean, sem } }` — each array `index.size` long, and null where a
 *          category lacks that metric — and `means`, one pair per metric across all of them.
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

  return { ...rest, taskType, index, metrics, means: toMeans(metrics) };
}

export { REGION_TASK_TYPE, toScoreDetail };
