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
  "ts2-co_smoothing": "Co-smooth",
  "ts2-forecasting": "Forecast",
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
  const derived = new Set(taskSubmissions.map((ts) => suiteFromTask(ts.task_id)).filter(Boolean));

  return SUITES.filter((suite) => derived.has(suite));
}

// A model's suites, from whichever it carries: a list endpoint names them outright, a
// breakdown names its tasks, and a detail leaves them to be read off the submissions.
function suitesFromModel(model) {
  const named = model.task_suites ?? model.suites;

  if (named?.length) {
    return SUITES.filter((suite) => named.includes(suite));
  }

  const scored = new Set(
    Object.keys(model.tasks ?? {})
      .map(suiteFromTask)
      .filter(Boolean),
  );

  if (scored.size) return SUITES.filter((suite) => scored.has(suite));

  const derived = new Set((model.submissions ?? []).flatMap(suitesFromSubmission));

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

// TS3 reports one set of metrics per brain region, and a macro average over them, so a
// metric name may arrive with a region on the front of it — "TH/f1-score", "macro/precision".
const REGION_SEPARATOR = "/";

const MACRO_REGION = "macro";

// How a metric is written wherever one is shown. Keyed by the names the scorers write — see
// app/scoring — which are what the benchmark calls them rather than what a reader reads.
const METRIC_NAMES = {
  ap: "AP",
  bacc: "BAcc",
  bps: "BPS",
  d2: "D²",
  f1: "F1",
  "f1-score": "F1",
  mae: "MAE",
  pearson: "Pearson r",
  poisson_d2: "Poisson D²",
  precision: "Precision",
  r2: "R²",
  recall: "Recall",
};

// What each suite reports, in the order a reader meets them, keyed by the names the scorers
// write. Beside METRIC_NAMES so a metric is named once and listed once: the landing page used
// to spell its own, and four of the eleven had drifted from these.
//
// TS3's are per brain region with a macro average over them, and the average is what the
// cards name — see REGION_SEPARATOR.
const SUITE_METRICS = {
  ts1: ["bacc", "r2", "poisson_d2", "mae", "f1", "ap", "pearson", "bps"],
  ts2: ["poisson_d2", "bps"],
  ts3: ["macro/f1-score", "precision", "recall"],
};

/**
 * How a metric is written wherever one is shown — a badge, a button, a heatmap block.
 *
 * A metric this does not name reads as it arrived, as an unnamed task does: one the benchmark
 * has added shows up before it is named here.
 *
 * @param metric the scorers' own name, region-prefixed or not.
 * @returns the label.
 */
function metricLabel(metric) {
  const name = String(metric ?? "");

  if (!name) return "";

  const at = name.indexOf(REGION_SEPARATOR);

  if (at < 0) return METRIC_NAMES[name] ?? name;

  const region = name.slice(0, at);

  // A region is already written as it reads — "TH", "Isocortex" — where the average over
  // them is the one prefix that is a word.
  return `${region === MACRO_REGION ? "Macro" : region} ${metricLabel(name.slice(at + 1))}`;
}

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

// How a task type is written wherever one is named — over a plot of everything measured that
// way. Keyed by TASK_TYPES' own values.
const TASK_TYPE_NAMES = {
  categorical: "Categorical",
  continuous: "Continuous",
  point_process: "Point process",
  firing_rate: "Firing rate",
  brain_region: "Brain region",
};

function taskTypeLabel(taskType) {
  return TASK_TYPE_NAMES[taskType] ?? taskType ?? "";
}

// The suite in front of the short name — "TS1 Choice". What a task is called wherever it is
// named away from its suite: a chip on a comparison, a badge on a list spanning all three.
function taskFullLabel(taskId) {
  return [suiteLabel(suiteFromTask(taskId)), taskLabel(taskId)].filter(Boolean).join(" ");
}

function taskTypeOf(taskId) {
  return TASK_TYPES[taskId] ?? suiteFromTask(taskId) ?? "";
}

// The metrics a suite reports. Empty for a suite this does not name, as the labels are for a
// metric it does not name.
function metricsForSuite(suite) {
  return SUITE_METRICS[suite] ?? [];
}

export {
  REGION_SEPARATOR,
  SUITES,
  metricLabel,
  metricsForSuite,
  suiteFromTask,
  suiteLabel,
  taskFullLabel,
  taskLabel,
  taskTypeLabel,
  taskTypeOf,
  suitesFromModel,
  suitesFromSubmission,
};
