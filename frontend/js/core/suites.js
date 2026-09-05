const SUITES = ["ts1", "ts2", "ts3"];


// A task in as few words as read it. The id names what was decoded and how it was measured
// — "whisker_motion_energy" — where an axis tick or a column head only has to say which task
// it is, and the metric is written beside it anyway. Keyed by the ids in
// alembic/versions/0001_initial.py.
const TASK_NAMES = {
  "ts1-choice": "Choice",
  "ts1-left_paw_speed": "Left paw",
  "ts1-licking_rate": "Licking",
  "ts1-reward": "Reward",
  "ts1-right_paw_speed": "Right paw",
  "ts1-stimulus_contrast": "Stimulus",
  "ts1-wheel_speed": "Wheel",
  "ts1-whisker_motion_energy": "Whisker",
  "ts2-co_smoothing": "Co-smoothing",
  "ts2-forecasting": "Forecasting",
  "ts3-cosmos": "Cosmos",
};

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

// Keyed by the ids in alembic/versions/0001_initial.py, as TASK_NAMES is. What a task's
// numbers mean rather than which suite they came from: ts1's poisson_d2 reads out behaviour
// and ts2's reconstructs firing, so the two are not one scale.
const TASK_TYPES = {
  "ts1-choice": "categorical",
  "ts1-left_paw_speed": "continuous",
  "ts1-licking_rate": "point_process",
  "ts1-reward": "categorical",
  "ts1-right_paw_speed": "continuous",
  "ts1-stimulus_contrast": "categorical",
  "ts1-wheel_speed": "continuous",
  "ts1-whisker_motion_energy": "continuous",
  "ts2-co_smoothing": "firing_rate",
  "ts2-forecasting": "firing_rate",
  "ts3-cosmos": "brain_region",
};

function suiteFromTask(taskId) {
  const prefix = String(taskId ?? "").split("-")[0];

  return SUITES.includes(prefix) ? prefix : null;
}

// How a task is written wherever one is shown — an axis tick, a column head, a filter
// option. Its short name, falling back to the part of the id that differs: a task added to
// the table before it is named above still reads, and every suite is already named beside it
// by a badge or a heading. The id itself is what a tooltip or a key shows.
function taskLabel(taskId) {
  if (TASK_NAMES[taskId]) return TASK_NAMES[taskId];

  return suiteFromTask(taskId) ? taskId.slice(taskId.indexOf("-") + 1) : taskId;
}

function taskTypeOf(taskId) {
  return TASK_TYPES[taskId] ?? suiteFromTask(taskId) ?? "";
}

export {
  SUITES,
  suiteFromTask,
  suiteLabel,
  taskLabel,
  taskTypeOf,
  suitesFromModel,
  suitesFromSubmission,
};
