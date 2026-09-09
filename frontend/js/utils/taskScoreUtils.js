// A task score as the pages read it: its rows and the filters over them.
//
// The panel a score row opens is SCORE_PANEL in comparisons/taskScoreComparison.js.

import { metricLabel, suiteFromTask, taskFullLabel, taskLabel } from "../core/suites.js";
import {
  TASK_FIELDS,
  toMethodologyValues,
  trainingFieldKeys,
} from "../schemas/taskSubmissionSchema.js";
import { buildSuiteCoverageBadges } from "../components/badges.js";
import {
  matchEquals,
  matchInArray,
  matchIncludes,
  optionsFromRows,
  SUITE_OPTIONS,
} from "../components/filters.js";

// ─── ROWS ────────────────────────────────────────────────────────────────────

// A task submission read through GET /api/users/me/task-submissions already names the
// submission and model it belongs to; the same task read through a submission or model
// detail is nested inside that context instead. Lifting the nested shape into the flat one
// leaves a single row builder for both.
function flattenSubmissions(submissions) {
  return submissions.flatMap((submission) =>
    (submission.task_submissions ?? []).map((taskSubmission) => ({
      ...taskSubmission,
      submission_id: submission.id,
      submission_name: submission.label,
      // Whether the run behind the score is published, which is a different question from
      // whether the public ranking is standing on it.
      is_public: submission.is_public ?? null,
      // Absent on a model *detail* response's submissions, so a caller flattening several
      // models attaches them itself before calling in.
      model_id: submission.model_id,
      model_name: submission.model_name,
    })),
  );
}

function toScoreRow(result) {
  return {
    id: result.id,
    task_id: result.task_id,
    task_name: result.task_id,
    suite: suiteFromTask(result.task_id),
    submission_id: result.submission_id ?? null,
    submission_label: result.submission_name ?? null,
    is_public: result.is_public ?? null,
    model_id: result.model_id ?? null,
    model_name: result.model_name ?? null,
    // All three null on a task that isn't scored yet. `sem` is nullable even on a scored
    // one — a single-seed run has a mean but no spread.
    mean_score: result.score?.primary_metric_mean ?? null,
    sem: result.score?.primary_metric_sem ?? null,
    metric: result.score?.primary_metric ?? null,

    // How the task was produced. Absent from a model detail's nested tasks before the API
    // carries it — see app/schemas/models.py.
    ...toMethodologyValues(result),
  };
}

// For records that nest their tasks — a submission detail, or a model detail's
// submissions.
function toScoreRows(submissions) {
  return flattenSubmissions(submissions).map(toScoreRow);
}

// For GET /api/users/me/task-submissions, which is already one task per row.
function toScoreResultRows(results) {
  return (results ?? []).map(toScoreRow);
}

// ─── BESTS ───────────────────────────────────────────────────────────────────

/**
 * The best score reached on each task, out of a run of score rows.
 *
 * Best is highest: every task's primary metric — bacc, poisson_d2, r2, d2, macro/f1-score,
 * see alembic/versions/0001_initial.py — reads better the larger it is. A lower-is-better
 * primary metric would invert this silently; `mae` is one, and is never a primary metric.
 *
 * Rows with no score are dropped rather than kept at nothing: a task being scored has no
 * best yet.
 *
 * @param rows from toScoreRows / toScoreResultRows.
 *
 * @returns one row per task, the winning row itself — so it still names the model and
 *          submission the score came from.
 */
function toBestScoreRows(rows) {
  const best = new Map();

  for (const row of rows) {
    if (row.mean_score == null) continue;

    const standing = best.get(row.task_id);

    if (!standing || row.mean_score > standing.mean_score) {
      best.set(row.task_id, row);
    }
  }

  return [...best.values()];
}

// ─── FILTERS ─────────────────────────────────────────────────────────────────

// Short names, which are unique across the suites, and the suite as the class — so a pinned
// task wears the colour of the suite it came from.
function taskOptions(rows) {
  return [...new Set(rows.map((row) => row.task_id).filter(Boolean))].sort().map((taskId) => ({
    value: taskId,
    label: taskLabel(taskId),
    className: suiteFromTask(taskId),
  }));
}

// Typed text against a task, matched on both the name the reader sees and the id it is
// stored as — "TS1 Choice" and "ts1-choice" are the same task, and either is a fair thing to
// type. The pinned Task control beside this one is for picking whole tasks out; this is for
// finding them.
function matchTaskText(row, value) {
  return `${row.task_id} ${taskFullLabel(row.task_id)}`.toLowerCase().includes(value.toLowerCase());
}

// How each task was produced: the methodology panel of a task submission, whatever it holds.
// Two of them hold arrays, so what a row is matched by depends on the field.
function getMethodologyFilters() {
  return trainingFieldKeys().map((key) => ({
    type: "pinned",
    name: key,
    label: TASK_FIELDS[key].label,
    options: TASK_FIELDS[key].options ?? [],
    match: TASK_FIELDS[key].input === "checkbox-list" ? matchInArray(key) : matchEquals(key),
  }));
}

/**
 * The filter bar over a set of task-score rows — the same set wherever tasks are listed, so
 * a reader asks the same questions of a model's scores, a submission's tasks and the whole
 * field. See getTaskSubmissionFilters, which is this.
 *
 * The task is asked twice on purpose: a search finds one among a hundred, and the pinned
 * control holds the two or three being read. No submission control — a submission is where a
 * score came from rather than something about it, and the column says which.
 *
 * `suite` is a single value per row here, not the array the submission and model tables
 * carry, so it matches with matchEquals rather than matchInArray.
 *
 * The methodology fields are always among them: every one of these lists is task
 * submissions, and how a task was produced is the question they exist to be asked. Their
 * options come from the server's own enums, filled in place by loadTaskFields, which each of
 * those pages already calls.
 *
 * @param rows      every row, so the controls can offer only values that appear.
 * @param showModel add the model search. On where the rows span several models.
 *
 * @returns the controls, in bar order — see components/filterState.js.
 */
function getTaskScoreFilters(rows, { showModel = false } = {}) {
  // A search rather than a list of them: the rows can span every model the reader may see,
  // which is more names than a control should offer.
  const modelControl = showModel
    ? [
        {
          type: "search",
          name: "model_name",
          placeholder: "Search models...",
          match: matchIncludes("model_name"),
        },
      ]
    : [];

  return [
    {
      type: "search",
      name: "task_search",
      placeholder: "Search tasks...",
      match: matchTaskText,
    },
    {
      type: "pinned",
      name: "suite",
      label: "Suite",
      options: SUITE_OPTIONS,
      match: matchEquals("suite"),
    },
    {
      type: "pinned",
      name: "task_id",
      label: "Task",
      options: taskOptions(rows),
      match: matchEquals("task_id"),
    },
    {
      type: "pinned",
      name: "metric",
      label: "Metric",
      // The scorers' own names as the values, since that is what the rows carry, written the
      // way they read everywhere else.
      options: optionsFromRows(rows, "metric", metricLabel),
      match: matchEquals("metric"),
    },
    ...getMethodologyFilters(),
    ...modelControl,
  ];
}

// ─── DISPLAY ─────────────────────────────────────────────────────────────────

/**
 * Which suites a run of score rows covers, for the header of whoever the rows belong to.
 *
 * All three either way — the ones that are missing are the point, and grey is what says so.
 * See buildSuiteCoverageBadges, which the model listings badge coverage with too.
 *
 * @param scoreRows from toScoreRows / toScoreResultRows.
 *
 * @returns the badges, as renderHeader takes them.
 */
function getCoverageBadges(scoreRows) {
  const covered = new Set(scoreRows.map((row) => row.suite).filter(Boolean));

  return [buildSuiteCoverageBadges([...covered])];
}

export { getCoverageBadges, getTaskScoreFilters, toBestScoreRows, toScoreResultRows, toScoreRows };
