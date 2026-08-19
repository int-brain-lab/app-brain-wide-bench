import {escapeHtml} from "../core/utils.js";
import {SUITES} from "../core/suites.js";

function buildSuiteScoreBar(suite, score, rank) {
  const hasScore = score != null;
  const widthPct = hasScore ? Math.round(score * 100) : 0;
  const scoreText = hasScore ? score.toFixed(2) : "No score yet";
  const rankText = hasScore ? (rank == null ? "-" : `Rank #${rank}`) : "";

  return `
    <div class="card column gap-md ${hasScore ? "" : "disabled"}">
      <div class="row gap-md">
        <span class="badge ${escapeHtml(suite)}">${escapeHtml(suite.toUpperCase())}</span>
        <div class="bar-track wide-bar">
          <div class="bar wide-bar ${escapeHtml(suite)}" style="width:${widthPct}%"></div>
        </div>
        <div class="row gap-md">
          <span class="metadata">${escapeHtml(scoreText)}</span>
          ${rankText ? `<span class="metadata">${escapeHtml(rankText)}</span>` : ""}
        </div>
       </div>
    </div>`;
}


function buildSuiteScoreBars(meanScores, ranks) {
  return `
  <div class="column gap-md">
    ${SUITES
      .map(suite => buildSuiteScoreBar(suite, meanScores[suite] ?? null, ranks[suite] ?? null))
      .join("")}
  </div>
  `;
}


export {
  buildSuiteScoreBars
}