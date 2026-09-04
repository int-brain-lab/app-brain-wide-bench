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
    <div class="card column gap-md ${hasScore ? "" : "disabled"}">
      <div class="row gap-md">
        <span class="badge ${escapeHtml(suite)}">${escapeHtml(suiteLabel(suite))}</span>
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

// ─── MODEL BARS ──────────────────────────────────────────────────────────────

// The comparison page's overview: one bar per model on a single suite, best first.
//
// Every bar carries the suite's colour rather than one per model, because they are all
// measuring the same thing — what tells the models apart is the order and the label. The
// page's own model is badged instead, which is the same badge its column wears in the grids
// below.
//
// Coverage is stated on every bar, not just an incomplete one: two means over different
// task sets aren't quite comparable, and the reader can only allow for that if the counts
// are in front of them.
function buildModelScoreBar(entry, suite, totalTasks) {
  const hasScore = entry.mean != null;
  const widthPct = barWidth(entry.mean);

  const badge = entry.isSelected
    ? `<span class="badge sm neutral">This model</span>`
    : "";

  // Two lines rather than one dotted string: the team says whose model this is and the
  // count says how much of the suite the mean is over — the second is a caveat on the
  // number to its right, and it is easier to scan down a column of them than to find it
  // after a separator each time.
  const team = entry.teamName
    ? `<span class="metadata">${escapeHtml(entry.teamName)}</span>`
    : "";

  return `
    <div class="row gap-md model-bar ${hasScore ? "" : "disabled"}">
      <span class="column gap-xs model-bar-label">
        <span class="row left gap-sm">
          <span class="label">${escapeHtml(entry.recordName)}</span>
          ${badge}
        </span>
        ${team}
        <span class="metadata">${entry.scored}/${totalTasks} tasks</span>
      </span>
      <div class="bar-track thick-bar">
        <div class="bar thick-bar ${escapeHtml(suite)}" style="width:${widthPct}%"></div>
      </div>
      <span class="metadata model-bar-score">${escapeHtml(hasScore ? score(entry.mean) : "No score")}</span>
    </div>`;
}

/**
 * @param entries    compareData entries — whatever order they arrive in.
 * @param suite      the suite being compared, for the bar colour.
 * @param totalTasks how many tasks the comparison covers, for the coverage counts.
 *
 * One card holding every bar, not a card each: the point of the section is the comparison
 * between the rows, and a border around each one cuts the chart into six unrelated
 * readings.
 *
 * Sorted here rather than by the caller: "best first" is this section's own rule, and a
 * caller that forgot it would render a chart that quietly says something else. An unscored
 * model sorts last instead of leading with a zero-width bar.
 */
function buildModelScoreBars(entries, { suite, totalTasks }) {
  const ordered = [...entries].sort(
    (a, b) => (b.mean ?? -Infinity) - (a.mean ?? -Infinity),
  );

  return `
  <div class="card column gap-md">
    ${ordered.map((entry) => buildModelScoreBar(entry, suite, totalTasks)).join("")}
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

export { buildModelScoreBars, buildSuiteScoreBars, buildTaskScoreBars };
