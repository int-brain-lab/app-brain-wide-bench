import { escapeHtml, formatDate } from "../../utils.js";
import { renderDisplayFields } from "../../utils/form-fields.js";
import {
  buildOverallScore,
  buildStatCards,
  buildStatusBadge,
  buildSuiteBadges,
  buildSuiteCards,
  buildSuiteScoreBars,
} from "../../utils/score-cards.js";

// ─── HEADER ─────────────────────────────────────────────────────────────────

function renderModelHeader(model) {
  document.getElementById("page-title").textContent = model.name;
  document.getElementById("page-description").textContent =
    `${model.team_name} · Created ${formatDate(model.created_at)}`;
}


// ─── TAB - OVERVIEW ─────────────────────────────────────────────────────────

function renderModelScores(meanScores, ranks) {
  document.getElementById("overall-score-card").innerHTML = buildOverallScore(meanScores, ranks);
  document.getElementById("suite-list").innerHTML = buildSuiteScoreBars(meanScores, ranks);
}

function overviewStatistics(submissions, meanScores, taskCount) {
  return [
    ["submissions", submissions.length, "layers"],
    ["public submissions", submissions.filter(s => s.is_public).length, "globe"],
    ["task suites", Object.keys(meanScores).length - 1, "grid-3x3"],
    ["tasks", taskCount, "list-checks"],
  ];
}

function renderModelStatCards(statistics) {
  document.getElementById("model-stats").innerHTML = buildStatCards(statistics);
}

function renderOverviewDetailsCard(model, fields) {
  const keys = ["name", "created_at", "team_name", "link_code"];
  document.getElementById("model-details").innerHTML = renderDisplayFields(keys, model, fields);
}

function renderOverviewTab({ model, fields, submissions, meanScores, ranks, taskCount }) {
  renderModelScores(meanScores, ranks);
  renderModelStatCards(overviewStatistics(submissions, meanScores, taskCount));
  renderOverviewDetailsCard(model, fields);
}


// ─── TAB - DETAILS ──────────────────────────────────────────────────────────

function renderDetailsTab(model, fields) {
  document.getElementById("model-details-full").innerHTML =
    renderDisplayFields(Object.keys(fields), model, fields);
}


// ─── TAB - SUBMISSIONS ──────────────────────────────────────────────────────

function buildSubmissionRow(submission) {
  return `
    <tr>
      <td><a href="submission_details.html?id=${encodeURIComponent(submission.id)}">${escapeHtml(submission.label)}</a></td>
      <td>${escapeHtml(formatDate(submission.updated_at))}</td>
      <td>${buildStatusBadge(submission.status)}</td>
      <td><span class="row left gap-sm">${buildSuiteBadges(submission)}</span></td>
    </tr>`;
}

function renderSubmissionsTab(submissions) {
  document.getElementById("submissions-list").innerHTML = submissions.map(buildSubmissionRow).join("");
}


// ─── TAB - EVALUATION ───────────────────────────────────────────────────────

function renderEvaluationTab(suiteScores) {
  document.getElementById("evaluation-suites").innerHTML = buildSuiteCards(suiteScores);
}


export {
  renderModelHeader,
  renderOverviewTab,
  renderDetailsTab,
  renderSubmissionsTab,
  renderEvaluationTab,
};
