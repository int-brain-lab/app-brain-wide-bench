// Score maths shared by every page that shows suite/task scores — the model
// card, the submission card, and the submission list. Pure functions over the
// API's `task_submissions` shape; no DOM.

function suiteOf(taskId) {
  return taskId.split("-")[0];
}

function subtaskLabel(taskId) {
  return taskId.split("-").slice(1).join("-");
}

// Guarded: the list endpoint (SubmissionResponse) has no `task_submissions` —
// only the detail endpoint does — so a list row would otherwise throw here
// rather than just showing no suite badges.
function submissionSuites(submission) {
  const taskSubmissions = submission.task_submissions ?? [];
  return [...new Set(taskSubmissions.map(ts => suiteOf(ts.task_id)))];
}

// Takes a LIST of submissions (a model has many); for a single submission pass
// `[submission]`. Where two submissions cover the same task, the better score
// wins — a model's card should show its best result for each task.
function scoresBySuite(submissions) {
  const scores = {};

  for (const { task_submissions } of submissions) {
    for (const { task_id, score } of task_submissions) {
      const value = score?.primary_metric_mean;
      if (value == null) continue;

      const suite = suiteOf(task_id);
      scores[suite] ??= {};

      scores[suite][task_id] = Math.max(
        scores[suite][task_id] ?? -Infinity,
        value
      );
    }
  }

  return scores;
}

function getMeanScores(suiteScores) {
  const means = Object.fromEntries(
    Object.entries(suiteScores).map(([suite, tasks]) => {
      const values = Object.values(tasks);
      return [suite, values.reduce((a, b) => a + b, 0) / values.length];
    })
  );

  means.overall =
    Object.values(means).reduce((sum, mean) => sum + mean, 0) /
    Math.max(1, Object.keys(means).length);

  return means;
}

// Total number of scored tasks across every suite.
function countTasks(suiteScores) {
  return Object.values(suiteScores).reduce(
    (total, tasks) => total + Object.keys(tasks).length,
    0
  );
}

export { scoresBySuite, getMeanScores, submissionSuites, subtaskLabel, suiteOf, countTasks };
