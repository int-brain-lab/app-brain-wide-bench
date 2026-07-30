// Rendering for the submission card's Overview / Details / Evaluation tabs.
// The Tasks tab lives in tasks-view.js. Every score/stat builder here is the
// shared one from utils/score-cards.js — the same markup as the model card.

import { formatDate, renderMessage } from "../../utils.js";
import { renderDisplayFields } from "../../utils/form-fields.js";
import { submissionSuites } from "../../scores.js";
import {
  buildOverallScore,
  buildStatCards,
  buildSuiteCards,
  buildSuiteScoreBars,
} from "../../utils/score-cards.js";

// Keys shown in the short Overview card — the rest are on the Details tab.
const OVERVIEW_KEYS = ["label", "model_name", "team_name", "status", "created_at"];


// ─── HEADER ─────────────────────────────────────────────────────────────────

function renderSubmissionHeader(submission) {
  document.getElementById("page-title").textContent = submission.label ?? "Submission";
  document.getElementById("page-description").textContent =
    [
      submission.model_name,
      submission.team_name,
      submission.created_at ? `Created ${formatDate(submission.created_at)}` : null,
    ].filter(Boolean).join(" · ");
}


// ─── MESSAGES ───────────────────────────────────────────────────────────────

function showMessage(message, className = "info-msg") {
  const container = document.getElementById("form-message");

  if (!message) {
    container.hidden = true;
    container.replaceChildren();
    return;
  }

  renderMessage(container, message, className);
}


// ─── TAB - OVERVIEW ─────────────────────────────────────────────────────────

// No `ranks` argument: a rank belongs to a model on the leaderboard, not to an
// individual submission, so buildOverallScore omits that column here.
function renderSubmissionScores(meanScores) {
  document.getElementById("overall-score-card").innerHTML = buildOverallScore(meanScores);
  document.getElementById("suite-list").innerHTML = buildSuiteScoreBars(meanScores, {});
}

function overviewStatistics(submission, taskCount) {
  const taskSubmissions = submission.task_submissions ?? [];

  return [
    ["tasks", taskSubmissions.length, "list-checks"],
    ["task suites", submissionSuites(submission).length, "grid-3x3"],
    ["scored tasks", taskCount, "check-check"],
    ["visibility", submission.is_public ? "Public" : "Private", "globe"],
  ];
}

function renderSubmissionStatCards(statistics) {
  document.getElementById("submission-stats").innerHTML = buildStatCards(statistics);
}

function renderOverviewDetailsCard(submission, fields) {
  document.getElementById("submission-details").innerHTML =
    renderDisplayFields(OVERVIEW_KEYS.filter(key => key in fields), submission, fields);
}

function renderOverviewTab({ submission, fields, meanScores, taskCount }) {
  renderSubmissionScores(meanScores);
  renderSubmissionStatCards(overviewStatistics(submission, taskCount));
  renderOverviewDetailsCard(submission, fields);
}


// ─── TAB - DETAILS ──────────────────────────────────────────────────────────

function renderDetailsTab(submission, fields) {
  document.getElementById("submission-details-full").innerHTML =
    renderDisplayFields(Object.keys(fields), submission, fields);
}


// ─── TAB - EVALUATION ───────────────────────────────────────────────────────

function renderEvaluationTab(suiteScores) {
  const container = document.getElementById("evaluation-suites");

  if (!Object.keys(suiteScores).length) {
    renderMessage(container, "No scores yet — this submission hasn't been scored.");
    return;
  }

  container.innerHTML = buildSuiteCards(suiteScores);
}


export {
  renderSubmissionHeader,
  renderOverviewTab,
  renderDetailsTab,
  renderEvaluationTab,
  showMessage,
};
