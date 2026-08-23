// Score aggregation for a single record's submissions.
//
// The shaping step that sits between the API and anything that draws scores — the suite
// bars, the stat cards, the mean a dashboard shows. scoreTable.js flattens submissions into
// one row per task; this module collapses them the other way, into one number per suite.
//
// Two app-wide rules live here, both deliberate:
//
//   1. Scores come from the *latest* submission, never the best across submissions.
//   2. A missing score is `null`, not `0` — including the overall mean. `mean` returns null
//      for an empty list rather than dividing by zero, and getMeanScores drops nulls before
//      averaging so an unattempted suite doesn't drag the overall figure down.
//
// It lives here rather than in a domain folder because model, submission and team pages all
// need the same collapse; it was duplicated between two model modules before this.

import { mean } from "./utils.js";
import { suiteFromTask } from "./suites.js";

// ─── LATEST ─────────────────────────────────────────────────────────────────

// TODO THIS IS INCORRECT WE DON"T WANT JUST THE LATEST SUBMISSION WE WANT THE LATEST FOR EACH TASK
function latestSubmission(submissions) {
  return submissions.reduce((latest, submission) => {
    if (!latest) return submission;

    return Date.parse(submission.created_at ?? 0) > Date.parse(latest.created_at ?? 0)
      ? submission
      : latest;
  }, null);
}

// The same "latest, not best" rule as above, applied per task rather than per submission:
// each task takes its score from the newest submission that scored it. A model whose ts1
// run and ts2 run were separate submissions is then read whole, which latestSubmission
// cannot do — see its TODO.
//
// Callers of latestSubmission are deliberately left on it: collapsing a *submission* into
// one figure per suite and collapsing a *model* into one figure per task are different
// questions, and only the second one is asked here.
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
    [...latest].map(([taskId, { mean, sem, metric }]) => [taskId, { mean, sem, metric }]),
  );
}


// ─── AGGREGATION ────────────────────────────────────────────────────────────

// { ts1: { "ts1-reward": 0.42, … }, ts2: { … } } — nested so callers can have either the
// per-task detail or, via getMeanScores, one figure per suite.
function scoresBySuite(submissions) {
  const latest = latestSubmission(submissions ?? []);
  const scores = {};

  for (const { task_id, score } of latest?.task_submissions ?? []) {
    const value = score?.primary_metric_mean;
    const suite = suiteFromTask(task_id);

    // An id naming no known suite is skipped rather than bucketed. Without this it would
    // key the result under the string "null" and show up as a fourth suite downstream.
    if (value == null || suite === null) continue;

    (scores[suite] ??= {})[task_id] = value;
  }

  return scores;
}

// One mean per suite, plus `overall`. Note `overall` is the mean *of the suite means*, not
// of every task — so a suite with one scored task counts as much as a suite with twenty.
function getMeanScores(suiteScores) {
  const means = Object.fromEntries(
    Object.entries(suiteScores).map(([suite, tasks]) => [suite, mean(Object.values(tasks))]),
  );

  means.overall = mean(Object.values(means).filter(value => value != null));

  return means;
}

// Total number of scored tasks across every suite.
function countTasks(suiteScores) {
  return Object.values(suiteScores).reduce((total, tasks) => total + Object.keys(tasks).length, 0);
}


export {
  latestSubmission,
  latestScoresByTask,
  scoresBySuite,
  getMeanScores,
  countTasks
};
