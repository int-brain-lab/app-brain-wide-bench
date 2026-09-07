import { score } from "../core/utils.js";
import { escapeHtml } from "../core/html.js";
import { suiteLabel, SUITES, taskLabel } from "../core/suites.js";
import { buildMetricBadge } from "./badges.js";

// r2 and poisson_d2 are unbounded below, so a real score can be negative — and
// `width: -14%` is not a short bar, it is no bar at all, silently identical to "no score".
// Clamped rather than hidden: the number beside it still reports what was measured.
function barWidth(value) {
  return value == null
    ? 0
    : Math.min(100, Math.max(0, Math.round(value * 100)));
}

function buildSuiteScoreBar(suite, score, rank) {
  const hasScore = score != null;
  const widthPct = barWidth(score);
  const scoreText = hasScore ? score.toFixed(2) : "No score yet";
  const rankText = hasScore ? (rank == null ? "-" : `Rank #${rank}`) : "";

  return `
    <div class="card column gap-lg ${hasScore ? "" : "disabled"}">
      <div class="row gap-lg">
        <span class="badge ${escapeHtml(suite)}">${escapeHtml(suiteLabel(suite))}</span>
        <div class="bar-track wide-bar">
          <div class="bar wide-bar ${escapeHtml(suite)}" style="width:${widthPct}%"></div>
        </div>
        <div class="row gap-lg">
          <span class="metadata">${escapeHtml(scoreText)}</span>
          ${rankText ? `<span class="metadata">${escapeHtml(rankText)}</span>` : ""}
        </div>
       </div>
    </div>`;
}

function buildSuiteScoreBars(meanScores, ranks) {
  return `
  <div class="column gap-lg">
    ${SUITES.map((suite) =>
      buildSuiteScoreBar(
        suite,
        meanScores[suite] ?? null,
        ranks[suite] ?? null,
      ),
    ).join("")}
  </div>
  `;
}

// ─── TASK BARS ───────────────────────────────────────────────────────────────

// One task's score: what it is called and what it was measured in above the bar, the number
// on top of the bar, and the bar in the colour of the suite the task belongs to.
//
// The track is wrapped in a row because it carries `flex: 1` — in the cell's own column that
// would grow it downwards rather than across.
function buildTaskScoreBar(row) {
  const hasScore = row.mean_score != null;

  return `
    <div class="card column gap-sm ${hasScore ? "" : "disabled"}">
      <span class="row gap-sm">
        <span class="label">${escapeHtml(taskLabel(row.task_id))}</span>
        ${row.metric ? buildMetricBadge(row.metric, "sm") : ""}
      </span>
      <span class="metadata">${escapeHtml(hasScore ? score(row.mean_score) : "No score yet")}</span>
      <span class="row">
        <div class="bar-track wide-bar">
          <div class="bar wide-bar ${escapeHtml(row.suite ?? "")}" style="width:${barWidth(row.mean_score)}%"></div>
        </div>
      </span>
    </div>`;
}

/**
 * A bar per task, four to a row.
 *
 * @param rows task-score rows — see toScoreRows in utils/taskScoreUtils.js.
 *
 * @returns the markup.
 */
function buildTaskScoreBars(rows) {
  // By suite and then by task, so the grid reads a suite at a time whatever order the rows
  // arrived in.
  const ordered = [...rows].sort(
    (a, b) =>
      SUITES.indexOf(a.suite) - SUITES.indexOf(b.suite) ||
      String(a.task_id).localeCompare(String(b.task_id)),
  );

  return `
    <div class="grid-4">
      ${ordered.map(buildTaskScoreBar).join("")}
    </div>`;
}

export { buildSuiteScoreBars, buildTaskScoreBars };
