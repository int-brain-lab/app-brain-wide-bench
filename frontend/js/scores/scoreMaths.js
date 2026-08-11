// The score primitives — the suite list, how a task id maps to a suite, and the averaging
// every page's scores go through. Pure functions, no DOM.
//
// One home for these on purpose. They were previously spread across js/scores.js,
// js/utils/score-cards.js and js/scores/leaderboardRows.js, with SUITES defined twice and
// "suite from task id" written four times — and, worse, two different answers to "which of
// a model's submissions counts". Both are settled here now:
//
//   latest wins   a model's score is its most recent submission's score, on its dashboard
//                 and on the leaderboard alike. It used to be the *best* score here and
//                 the *latest* on the leaderboard, so one model could show two numbers.
//   null, not 0   a record with nothing scored has a null overall. It used to come back as
//                 0 from getMeanScores, which reads as a genuine score of zero.
//
// Note both are strict: only the latest submission's tasks appear, so a task scored solely
// in a superseded submission drops out rather than being carried forward.

const SUITES = ["ts1", "ts2", "ts3"];

/**
 * The suite a task id belongs to, or null if it names none.
 *
 * Task ids are "<suite>-<subtask>" (e.g. "ts1-choice"), so the leading part is the
 * candidate — but it's checked against SUITES rather than trusted, which is what makes
 * this the one version worth having. The two it replaces each failed differently:
 *
 *   split("-")[0]        threw on null, and invented a suite from anything: "foo-bar" came
 *                        back as the bucket "foo", which then flowed into grouping.
 *   match(/^ts\d/)       null-safe and validating, but `\d` is exactly one digit — a
 *                        "ts10-foo" would silently report "ts1" — and it hardcodes the
 *                        "ts" prefix rather than deferring to the actual suite list.
 *
 * Validating against SUITES has neither problem, and moves the authority to the one place
 * the suites are declared. It does mean callers must expect null: the two that format the
 * result directly are guarded, and everything else compares or looks up, where null simply
 * doesn't match.
 *
 * Ids reaching this are usually server-side (`tasks.id` is a foreign key), but not always —
 * the submission create flow derives them from folder names inside a user's zip.
 */
function suiteOf(taskId) {
  const prefix = String(taskId ?? "").split("-")[0];

  return SUITES.includes(prefix) ? prefix : null;
}

function subtaskLabel(taskId) {
  return taskId.split("-").slice(1).join("-");
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}


// ─── SELECTION ──────────────────────────────────────────────────────────────

// The most recent of a set of submissions. Compared on `created_at`, which both
// ModelSubmissionOut and the leaderboard payload carry; a record without one sorts oldest
// rather than throwing, so a partial fixture degrades instead of breaking the page.
function latestSubmission(submissions) {
  return submissions.reduce((latest, submission) => {
    if (!latest) return submission;

    return Date.parse(submission.created_at ?? 0) > Date.parse(latest.created_at ?? 0)
      ? submission
      : latest;
  }, null);
}


// ─── SUITE SCORES ───────────────────────────────────────────────────────────

// Guarded: the list endpoint (SubmissionResponse) has no `task_submissions` — only the
// detail endpoint does — so a list row would otherwise throw here rather than just showing
// no suite badges.
function submissionSuites(submission) {
  const taskSubmissions = submission.task_submissions ?? [];

  // Nulls filtered out, so an unrecognised id contributes no badge rather than an empty one.
  return [...new Set(taskSubmissions.map(ts => suiteOf(ts.task_id)).filter(Boolean))];
}

/**
 * Scores grouped by suite, for a LIST of submissions (a model has many); for a single one
 * pass `[submission]`.
 *
 * Only the latest submission contributes. This used to take the best score per task across
 * all of them, which meant a model's dashboard could show a number no single submission
 * ever produced — and disagreed with the leaderboard, which takes the latest.
 *
 * @returns {Object.<string, Object.<string, number>>} suite -> { task id: mean }
 */
function scoresBySuite(submissions) {
  const latest = latestSubmission(submissions ?? []);
  const scores = {};

  for (const { task_id, score } of latest?.task_submissions ?? []) {
    const value = score?.primary_metric_mean;
    const suite = suiteOf(task_id);

    // An id naming no known suite is skipped rather than bucketed. Without this it would
    // key the result under the string "null" and show up as a fourth suite downstream.
    if (value == null || suite === null) continue;

    (scores[suite] ??= {})[task_id] = value;
  }

  return scores;
}

/**
 * Per-suite means plus an `overall` mean of the suites present.
 *
 * `overall` averages only the suites that have scores, so a model with ts1 and ts2 is
 * judged on those two rather than penalised for a missing ts3 — and is null, not 0, when
 * there is nothing scored at all. Callers used to have to special-case the zero.
 */
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
  SUITES,
  countTasks,
  getMeanScores,
  latestSubmission,
  mean,
  scoresBySuite,
  submissionSuites,
  subtaskLabel,
  suiteOf,
};
