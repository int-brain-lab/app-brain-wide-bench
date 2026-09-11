// One card per submission, for the submission list and the model dashboard.
//
// Built from a submission row — utils/submissionUtils.js's toSubmissionRows — so the
// cards, the filters above them and the table beside them read one shape.

import { escapeHtml } from "../core/html.js";
import { hrefForRecord } from "../core/links.js";
import { formatDate } from "../core/utils.js";
import { buildStatusBadge, buildSuiteBadgeList } from "../components/badges.js";
import { createCardGrid } from "./cardGrid.js";

const SUBMISSION_PAGE = "/html/submissions/submissions.html";

// `showTeam` off for a listing that is all one team's, where naming it on every card says
// nothing. The model stays either way: a team has several.
function buildSubmissionCard(submission, { showTeam = true } = {}) {
  return `
    <a
      class="card column left gap-lg"
      href="${hrefForRecord(SUBMISSION_PAGE, submission.id, { mine: submission.is_mine })}"
    >
      <div class="column left">
        <p class="label">${escapeHtml(submission.label)}</p>
        <p class="metadata">
          ${escapeHtml(submission.model_name || "—")}
          ${showTeam ? `· ${escapeHtml(submission.team_name || "—")}` : ""}
        </p>
      </div>

      <div class="row left gap-lg">
        ${buildSuiteBadgeList(submission.suites ?? [], "sm")}
        ${buildStatusBadge(submission.status, "sm")}
      </div>

      <p class="metadata">
        Updated ${escapeHtml(formatDate(submission.updated_at))}
      </p>
    </a>
  `;
}

function buildSubmissionCards(submissions, options) {
  return submissions.map((submission) => buildSubmissionCard(submission, options)).join("");
}

/**
 * The submission card grid, built once and kept.
 *
 * @param showTeam as buildSubmissionCard.
 * @param options  the rest, as createCardGrid.
 *
 * @returns as createCardGrid.
 */
function createSubmissionCardGrid({ showTeam = true, ...options } = {}) {
  return createCardGrid({
    buildCards: (rows) => buildSubmissionCards(rows, { showTeam }),
    noun: "submission",

    ...options,
  });
}

export { buildSubmissionCards, createSubmissionCardGrid };
