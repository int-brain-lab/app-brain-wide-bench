// The `score` view of the submission record page — one task score, broken down.
//
// The task-scores table shows a single mean per task, averaged over every recording. This is
// what sits behind that number: one row per recording, one column pair per metric. Reached
// by clicking the task name (taskScoreLinkFormatter), and deep-linkable as
// `?id=<submission>&view=score&score=<task submission>`.

import { showEmpty, showFailure } from "../core/utils.js";
import { getIcon } from "../components/icons.js";
import { buildStatCards } from "../cards/statCards.js";
import { buildSuiteBadgeList } from "../components/badges.js";
import { score } from "../tables/formatters.js";
import { suiteFromTask } from "../core/suites.js";
import {
  describeRecordingScores,
  renderRecordingScoresTable,
  summariseMetrics,
} from "../tables/recordingScoreTable.js";
import {
  buildBody,
  buildHeader,
  buildPage,
  buildStats,
  renderHeader,
  renderPage,
  sectionBody,
} from "../templates/record-page.js";

const BACK = {
  text: "← Back to task scores",
  view: "scores",
};

// ─── DATA ────────────────────────────────────────────────────────────────────

function getRecordings(taskSubmission) {
  return taskSubmission.score?.metrics?.recordings ?? [];
}

// One card per metric — bacc, f1, ap for ts1-reward — each aggregated across recordings by
// summariseMetric, which is the scorers' own task-summary computation. For the task's
// primary metric that reproduces the `primary_metric_mean` / `primary_metric_sem` the
// task-scores table and the leaderboard show, so the card and the row that was clicked
// agree; the other metrics get the same treatment, which the score carries no summary for.
//
// Nothing for TS3, whose rows are brain regions rather than recordings: a mean down that
// column would be a mean over regions, and its "macro" row already is exactly that — so the
// cards would either duplicate that row or, by including it, double-count it.
function getStatistics(taskSubmission) {
  const recordings = getRecordings(taskSubmission);

  if (describeRecordingScores(recordings).mode !== "recording") return [];

  return summariseMetrics(recordings).map(metric => [
    metric.name,
    metric.sem == null ? score(metric.mean) : `${score(metric.mean)} ± ${score(metric.sem)}`,
    getIcon("score"),
  ]);
}

function getSubtitle(submission, taskSubmission) {
  return [
    { text: taskSubmission.score?.primary_metric, icon: getIcon("score") },
    { text: submission.label, icon: getIcon("submission") },
    { text: submission.model_name, icon: getIcon("model") },
  ].filter(entry => entry.text);
}

function getBadges(taskSubmission) {
  const suite = suiteFromTask(taskSubmission.task_id);

  return [suite ? buildSuiteBadgeList([suite]) : ""];
}

// ─── VIEW ────────────────────────────────────────────────────────────────────

function renderScoreBreakdownView({ submission, score: taskSubmissionId }) {
  renderPage(
    buildPage({
      back: BACK,
      header: buildHeader(),
      body: buildStats() + buildBody(),
    }),
  );

  const taskSubmission = (submission.task_submissions ?? []).find(
    row => row.id === taskSubmissionId,
  );

  // Both reachable by editing the URL, and the second by a Back into a task whose score a
  // later re-scoring removed.
  if (!taskSubmission) {
    renderHeader(submission.label, submission.team_name ?? "");
    showFailure(sectionBody("body"), "That task is not part of this submission.");
    return;
  }

  renderHeader(
    taskSubmission.task_id,
    getSubtitle(submission, taskSubmission),
    getBadges(taskSubmission),
  );

  if (!taskSubmission.score) {
    showEmpty(sectionBody("body"), "This task has not been scored yet.");
    return;
  }

  sectionBody("stats").innerHTML = buildStatCards(getStatistics(taskSubmission));

  const recordings = getRecordings(taskSubmission);

  // A score with a mean but no per-recording detail: every score written by app/tasks/score.py
  // carries it, but one loaded from an older fixture has `metrics` null.
  if (!recordings.length) {
    showEmpty(sectionBody("body"), "No per-recording breakdown was stored for this score.");
    return;
  }

  return renderRecordingScoresTable({ container: sectionBody("body"), recordings });
}


export { renderScoreBreakdownView };
