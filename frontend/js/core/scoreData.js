// Score aggregation for a single record's submissions.
//
// The shaping step that sits between the API and anything that draws scores — the suite
// bars, the stat cards, the mean a dashboard shows. taskScoreUtils.js flattens submissions
// into one row per task; this module collapses them the other way, into one per suite.
//
// Two app-wide rules live here, both deliberate:
//
//   1. A task's score is the *latest* one submitted for it, never the best — and latest per
//      task, so a model whose ts1 run and ts2 run were separate submissions reads whole.
//      The same rule the server ranks on, so a page can put a score beside its rank.
//   2. A missing score is `null`, not `0` — including the overall mean. `mean` returns null
//      for an empty list rather than dividing by zero, and getMeanScores drops nulls before
//      averaging so an unattempted suite doesn't drag the overall figure down.
//
// It lives here rather than in a domain folder because model, submission and team pages all
// need the same collapse; it was duplicated between two model modules before this.

import { mean } from "./utils.js";

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

export { latestScoresByTask };
