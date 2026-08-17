
const SUITES = ["ts1", "ts2", "ts3"];

function suitesFromSubmission(submission) {
  if (submission.task_suites?.length) {
    return SUITES.filter(suite => submission.task_suites.includes(suite));
  }

  const taskSubmissions = submission.task_submissions ?? [];
  const derived = new Set(
    taskSubmissions
      .map(ts => suiteFromTask(ts.task_id))
      .filter(Boolean),
  );

  return SUITES.filter(suite => derived.has(suite));
}


function suiteFromTask(taskId) {
  const prefix = String(taskId ?? "").split("-")[0];

  return SUITES.includes(prefix) ? prefix : null;
}


export {
  SUITES,
  suiteFromTask,
  suitesFromSubmission
};