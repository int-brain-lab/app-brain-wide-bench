// Utility functions for processing submissions into table rows, and assigning ranks.


/**
 * Converts a flat list of submissions into one row per model,
 * with each task's score as a separate field and an overall mean score.
 *
 * @param {Submission[]} submissions - List of submission objects, where each
 *   object represents one model completing one task. Each submission should
 *   have title, affiliation, task, and summary fields.
 * @returns {LeaderboardRow[]} An array of row objects, one per unique model, each
 *   containing title, affiliation, individual task scores (ts1, ts2, ts3),
 *   and an overall mean score.
 */
function toTableRows(submissions) {
  const rowsByModel = new Map();

  for (const submission of submissions) {
    const modelKey = `${submission.title}|${submission.affiliation}`;

    if (!rowsByModel.has(modelKey)) {
      rowsByModel.set(modelKey, {
        title: submission.title,
        affiliation: submission.affiliation,
      });
    }

    const modelRow = rowsByModel.get(modelKey);
    modelRow[submission.task] = suiteMean(submission.summary);
  }

  const rows = [...rowsByModel.values()];
  rows.forEach((row) => {
    row.overall = overallMean(row);
  });

  assignRanks(rows, 'overall')

  return rows;
}

/**
 * Calculates the mean score for a submission by averaging the mean values
 * of all its metrics.
 *
 * @param {Object.<string, {mean: number}>} summary - An object where each key
 *   is a metric name and each value is an object containing a mean score.
 * @returns {number|null} The average of all metric mean values,
 *   or null if the summary is empty.
 *
 * @example
 * suiteMean({
 *   "ts1-choice": { mean: 0.834 },
 *   "ts1-block":  { mean: 0.812 },
 * });
 * // returns 0.823
 */
function suiteMean(summary) {
  const metrics = Object.values(summary);
  if (metrics.length === 0) return null;

  let total = 0;
  for (const metric of metrics) {
    total += metric.mean;
  }
  return total / metrics.length;
}

/**
 * Calculates the overall mean score for a model by averaging whichever
 * task suite scores are present. Missing suites are skipped entirely
 * rather than being counted as zero, so a model with only ts1 and ts2
 * is judged on those two scores alone.
 *
 * @param {LeaderboardRow} row - A row object representing a single model,
 *   expected to have some or all of the task suite scores ts1, ts2, ts3.
 * @returns {number|null} The mean of all present suite scores,
 *   or null if the model has no scores at all.
 *
 * @example
 * overallMean({ ts1: 0.834, ts2: 0.812, ts3: 0.756 });
 * // returns 0.8006...
 *
 * @example
 * // ts2 is skipped, not counted as zero
 * overallMean({ ts1: 0.834, ts3: 0.756 });
 * // returns 0.795
 */
function overallMean(row) {
  const scores = ["ts1", "ts2", "ts3"].map((k) => row[k]).filter((v) => v != null);
  if (scores.length === 0) return null;
  return scores.reduce((sum, v) => sum + v, 0) / scores.length;
}

/**
 * Assigns a stable rank to each model row based on a chosen metric score,
 * where rank 1 is the highest score. Ranks are written directly onto each
 * row object and represent the model's leaderboard position — they do not
 * change when the table is subsequently re-sorted or filtered for display.
 *
 * Uses standard competition ranking (1224 ranking): models with equal scores
 * receive the same rank, and the next rank is skipped accordingly.
 *
 * Models with no score for the chosen metric are ranked last.
 *
 * @param {LeaderboardRow[]} rows - Array of row objects to rank. Each row
 *   is mutated in place by adding a rank property.
 * @param {"overall"|"ts1"|"ts2"|"ts3"} [metric="overall"] - The score field
 *   to rank by. Defaults to "overall" if not specified.
 * @returns {void}
 *
 * @example
 * assignRanks(rows);
 * // Model A: 0.90 → rank 1
 * // Model B: 0.85 → rank 2
 * // Model C: 0.85 → rank 2  (tied)
 * // Model D: 0.72 → rank 4  (rank 3 skipped)
 */
function assignRanks(rows, metric = "overall") {
  const byScore = [...rows].sort((a, b) => (b[metric] ?? -Infinity) - (a[metric] ?? -Infinity));

  byScore.forEach((row, i) => {
    const previousRow = byScore[i - 1];
    const EPSILON = 1e-10;
    const tiedWithPrevious = previousRow && Math.abs(row[metric] - previousRow[metric]) < EPSILON;
    row.rank = tiedWithPrevious ? previousRow.rank : i + 1;
  });
}


// Build a lookup over the public leaderboard: "title|affiliation" -> model row with
// {overall, ts1, ts2, ts3, rank}, where rank is by Overall across all models.
// Used by the dashboard and the models pages to attach scores/rank to a user's models.
function leaderboardIndex(leaderboardSubmissions) {
  const rows = toTableRows(leaderboardSubmissions);
  [...rows]
    .sort((a, b) => (b.overall ?? -Infinity) - (a.overall ?? -Infinity))
    .forEach((row, i) => {
      row.rank = i + 1;
    });
  const map = new Map(rows.map((r) => [`${r.title}|${r.affiliation}`, r]));
  return { map, total: rows.length };
}


