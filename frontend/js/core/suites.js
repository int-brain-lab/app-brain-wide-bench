const SUITES = ["ts1", "ts2", "ts3"];

// How a suite is written wherever one is shown — a badge, a filter option, a heading.
function suiteLabel(suite) {
  return suite ? suite.toUpperCase() : null;
}

function suitesFromSubmission(submission) {
  if (submission.task_suites?.length) {
    return SUITES.filter((suite) => submission.task_suites.includes(suite));
  }

  const taskSubmissions = submission.task_submissions ?? [];
  const derived = new Set(
    taskSubmissions.map((ts) => suiteFromTask(ts.task_id)).filter(Boolean),
  );

  return SUITES.filter((suite) => derived.has(suite));
}

// A model's suites, from whichever it carries: a list endpoint names them outright, while a
// detail leaves them to be read off the submissions.
function suitesFromModel(model) {
  const named = model.task_suites ?? model.suites;

  if (named?.length) {
    return SUITES.filter((suite) => named.includes(suite));
  }

  const derived = new Set(
    (model.submissions ?? []).flatMap(suitesFromSubmission),
  );

  return SUITES.filter((suite) => derived.has(suite));
}

function suiteFromTask(taskId) {
  const prefix = String(taskId ?? "").split("-")[0];

  return SUITES.includes(prefix) ? prefix : null;
}

export {
  SUITES,
  suiteFromTask,
  suiteLabel,
  suitesFromModel,
  suitesFromSubmission,
};
