// Score/stat card builders shared by the model card and the submission card.
// Pure string builders — each caller does its own DOM write, so nothing here
// assumes a particular element id.

import { escapeHtml } from "../utils.js";
import { SUITES, submissionSuites } from "../scores/scoreMaths.js";

// The suites a submission has results for, whichever shape the record arrived in.
//
// `task_suites` is the server's own summary: the list endpoints compute it in SQL over
// scored tasks only (see suites_by_submission in app/routers/submissions.py). A detail
// response omits it and embeds `task_submissions` in full instead, so derive from
// those when it's absent — that's the shape model_dashboard and model_submissions
// pass in.
//
// Filtered through SUITES rather than returned as-is, so the order is the same either
// way and badges line up down a column.
function suitesOf(submission) {
  if (submission.task_suites?.length) {
    return SUITES.filter(suite => submission.task_suites.includes(suite));
  }

  const derived = new Set(submissionSuites(submission));

  return SUITES.filter(suite => derived.has(suite));
}

function statusBadgeClass(status) {
  return { done: "success", scoring: "pending", failed: "error", pending: "pending" }[status] ?? "";
}


// ─── OVERVIEW ───────────────────────────────────────────────────────────────


// One wide bar per task suite. A suite with no score renders disabled rather
// // than being omitted, so the card always shows all three.
// function buildSuiteScoreBar(suite, score, rank) {
//   const hasScore = score != null;
//   const widthPct = hasScore ? Math.round(score * 100) : 0;
//   const scoreText = hasScore ? score.toFixed(2) : "No score yet";
//   const rankText = hasScore ? (rank == null ? "-" : `Rank #${rank}`) : "";
//
//   return `
//     <div class="card column gap-md ${escapeHtml(suite)}-bg ${hasScore ? "" : "disabled"}">
//       <div class="row">
//         <span class="label ${escapeHtml(suite)}">${escapeHtml(suite.toUpperCase())}</span>
//         <div class="row gap-md">
//           <span class="label">${escapeHtml(scoreText)}</span>
//           ${rankText ? `<span class="label">${escapeHtml(rankText)}</span>` : ""}
//         </div>
//       </div>
//       <div class="bar-track wide-bar">
//         <div class="bar wide-bar ${escapeHtml(suite)}" style="width:${widthPct}%"></div>
//       </div>
//     </div>`;
// }


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



// ─── BADGES ─────────────────────────────────────────────────────────────────

// Split from buildSuiteBadges so a caller that has already derived a row's suites
// (the submissions table computes them once, to filter on) renders the same markup
// without going back through a submission object it no longer has.
function buildSuiteBadgeList(suites) {
  return suites
    .map(suite => `<span class="badge sm ${escapeHtml(suite)}">${escapeHtml(suite.toUpperCase())}</span>`)
    .join("");
}


// Every suite, with the ones absent from `suites` greyed out rather than omitted.
//
// For a model card, where the row reads as *coverage*: "no TS2 results" is itself
// information, and dropping the badge would leave a shorter row that just looks like
// less data. Contrast buildSuiteBadgeList, which lists only what's there — right for
// a submission or a table cell, where the row is one record's own suites rather than
// a claim about all three.
function buildSuiteCoverageBadges(suites) {
  const covered = new Set(suites);

  return SUITES
    .map(suite => {
      // `suite` is from our own SUITES, so the class is safe either way; escaped for
      // the same uniformity as everywhere else in this file.
      const variant = covered.has(suite) ? escapeHtml(suite) : "neutral";

      return `<span class="badge sm ${variant}">${escapeHtml(suite.toUpperCase())}</span>`;
    })
    .join("");
}

// statusBadgeClass maps through a fixed whitelist, so its result is safe in the
// class attribute — but the raw status still needs escaping where it's shown.
function buildStatusBadge(status) {
  return `<span class="badge sm ${statusBadgeClass(status)}">${escapeHtml(status)}</span>`;
}


// ─── EVALUATION ─────────────────────────────────────────────────────────────





export {
  SUITES,
  suitesOf,
  buildStatusBadge,
  buildSuiteBadgeList,
  buildSuiteCoverageBadges,
  buildSuiteScoreBars,
};
