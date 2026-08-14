// Every task score the caller can see, across all their models and submissions.
//
// There is no endpoint for this: /api/submissions returns SubmissionResponse, which has
// no task_submissions, and /api/leaderboard is scoped to public+done work. The only
// source of scores is a model *detail* response, whose embedded submissions carry
// task_submissions with their scores — so this fans out one request per model.
//
// That is N+1 by construction and the main cost on both pages that use it. A
// `GET /api/users/me/scores` returning the flattened rows would collapse it to one call;
// worth doing if the model count grows past a handful.

import { getMyModels, loadModel } from "../models/modelApi.js";
import { getTaskSuites } from "../tasks/taskSubmissionApi.js";


// A model detail's submissions are ModelSubmissionOut, which carries no model_name or
// model_id — the model is implied by which response they arrived in. The task-scores
// table needs both for its Model column and filter, so they're attached here while
// that context still exists.
function withModel(model) {
  return (model.submissions ?? []).map(submission => ({
    ...submission,
    model_id: model.id,
    model_name: model.name,
  }));
}

/**
 * @returns {{ models, submissions, tasks }} — `models` as listed (with n_submissions and
 *          task_suites), `submissions` flattened across every model and tagged with it,
 *          and the task catalogue for the Metric column.
 */
async function loadAllScores() {
  const [models, tasks] = await Promise.all([getMyModels(), getTaskSuites()]);

  if (!models?.length) {
    return { models: models ?? [], submissions: [], tasks };
  }

  // In parallel rather than in sequence: these are independent reads, and serialising
  // them would make the page wait N round trips instead of one.
  const details = await Promise.all(models.map(model => loadModel(model.id)));

  const submissions = details
    .filter(Boolean)          // loadModel logs and returns undefined on failure
    .flatMap(withModel);

  return { models, submissions, tasks };
}

export { loadAllScores };
