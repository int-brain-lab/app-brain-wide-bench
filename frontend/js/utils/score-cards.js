// Score/stat card builders shared by the model card and the submission card.
// Pure string builders — each caller does its own DOM write, so nothing here
// assumes a particular element id.

import { escapeHtml } from "../utils.js";
import { submissionSuites, subtaskLabel } from "../scores.js";

const SUITES = ["ts1", "ts2", "ts3"];

function statusBadgeClass(status) {
  return { done: "success", scoring: "pending", failed: "error", pending: "pending" }[status] ?? "";
}


// ─── OVERVIEW ───────────────────────────────────────────────────────────────

// `ranks` is optional: a submission has no leaderboard rank of its own, so the
// rank column is omitted rather than shown as a placeholder. An unscored record
// gives `overall` of 0 from getMeanScores, which would read as a real score —
// pass a null/NaN overall for those and it shows "—".
function buildOverallScore(meanScores, ranks = {}) {
  const overall = meanScores.overall;
  const hasScore = overall != null && !Number.isNaN(overall);
  const rank = ranks.overall;

  return `
    <div class="row">
      <span class="card-description">Overall score</span>
      ${rank == null ? "" : `<span class="card-description">Leaderboard</span>`}
    </div>
    <div class="row">
      <span class="statistic">${hasScore ? overall.toFixed(3) : "—"}</span>
      ${rank == null ? "" : `<span class="label">Rank #${escapeHtml(rank)}</span>`}
    </div>`;
}

// One wide bar per task suite. A suite with no score renders disabled rather
// than being omitted, so the card always shows all three.
function buildSuiteScoreBar(suite, score, rank) {
  const hasScore = score != null;
  const widthPct = hasScore ? Math.round(score * 100) : 0;
  const scoreText = hasScore ? score.toFixed(2) : "No score yet";
  const rankText = hasScore ? (rank == null ? "-" : `Rank #${rank}`) : "";

  return `
    <div class="card column gap-md ${escapeHtml(suite)}-bg ${hasScore ? "" : "disabled"}">
      <div class="row">
        <span class="label ${escapeHtml(suite)}">${escapeHtml(suite.toUpperCase())}</span>
        <div class="row gap-md">
          <span class="label">${escapeHtml(scoreText)}</span>
          ${rankText ? `<span class="label">${escapeHtml(rankText)}</span>` : ""}
        </div>
      </div>
      <div class="bar-track wide-bar">
        <div class="bar wide-bar ${escapeHtml(suite)}" style="width:${widthPct}%"></div>
      </div>
    </div>`;
}

function buildSuiteScoreBars(meanScores, ranks) {
  return SUITES
    .map(suite => buildSuiteScoreBar(suite, meanScores[suite] ?? null, ranks[suite] ?? null))
    .join("");
}

function buildStatCard([label, value, icon]) {
  return `
    <div class="stat-card secondary column centre gap-lg">
      <div class="row gap-sm">
        <i class="stat-icon" data-lucide="${escapeHtml(icon)}"></i>
        <p class="statistic tile">${escapeHtml(value)}</p>
      </div>
      <p class="metadata">${escapeHtml(label)}</p>
    </div>`;
}

function buildStatCards(statistics) {
  return statistics.map(buildStatCard).join("");
}


// ─── BADGES ─────────────────────────────────────────────────────────────────

function buildSuiteBadges(submission) {
  return submissionSuites(submission)
    .map(suite => `<span class="badge ${escapeHtml(suite)}">${escapeHtml(suite.toUpperCase())}</span>`)
    .join("");
}

// statusBadgeClass maps through a fixed whitelist, so its result is safe in the
// class attribute — but the raw status still needs escaping where it's shown.
function buildStatusBadge(status) {
  return `<span class="badge ${statusBadgeClass(status)}">${escapeHtml(status)}</span>`;
}


// ─── EVALUATION ─────────────────────────────────────────────────────────────

function buildTaskBar(suite, taskId, mean) {
  const widthPct = mean == null ? 0 : Math.round(mean * 100);
  const valueText = mean == null ? "-" : mean.toFixed(2);

  return `
    <div class="column gap-xs">
      <div class="row">
        <span class="label muted">${escapeHtml(subtaskLabel(taskId))}</span>
        <span class="label">${escapeHtml(valueText)}</span>
      </div>
      <div class="bar-track wide-bar">
        <div class="bar wide-bar ${escapeHtml(suite)}" style="width:${widthPct}%"></div>
      </div>
    </div>`;
}

function buildSuiteCard(suite, tasks) {
  const bars = Object.entries(tasks)
    .map(([taskId, mean]) => buildTaskBar(suite, taskId, mean))
    .join("");

  return `
    <div class="card secondary column gap-md">
      <span class="card-description">${escapeHtml(suite.toUpperCase())}</span>
      ${bars}
    </div>`;
}

function buildSuiteCards(suiteScores) {
  return Object.entries(suiteScores)
    .map(([suite, tasks]) => buildSuiteCard(suite, tasks))
    .join("");
}


export {
  SUITES,
  statusBadgeClass,
  buildOverallScore,
  buildSuiteScoreBar,
  buildSuiteScoreBars,
  buildStatCard,
  buildStatCards,
  buildSuiteBadges,
  buildStatusBadge,
  buildTaskBar,
  buildSuiteCard,
  buildSuiteCards,
};
