// One card per submission, for the submission list and the model dashboard.
//
// Built from a submission row — utils/submissionUtils.js's toSubmissionRows — so the
// cards, the filters above them and the table beside them read one shape.

import { escapeHtml } from "../core/html.js";
import { formatDate } from "../core/utils.js";
import { buildStatusBadge, buildSuiteBadgeList } from "../components/badges.js";
import { createCardGrid } from "./cardGrid.js";

function buildSubmissionCard(submission) {
  return `
    <a
      class="card column left gap-md"
      href="/html/submissions/submissions.html?id=${encodeURIComponent(submission.id)}"
    >
      <div class="column left">
        <p class="title">${escapeHtml(submission.label)}</p>
        <p class="metadata">
          ${escapeHtml(submission.model_name || "—")} ·
          ${escapeHtml(submission.team_name || "—")}
        </p>
      </div>

      <div class="row left gap-md">
        ${buildSuiteBadgeList(submission.suites ?? [], "sm")}
        ${buildStatusBadge(submission.status, "sm")}
      </div>

      <p class="metadata">
        Updated ${escapeHtml(formatDate(submission.updated_at))}
      </p>
    </a>
  `;
}

function buildSubmissionCards(submissions) {
  return submissions.map(buildSubmissionCard).join("");
}

/**
 * The submission card grid, built once and kept.
 *
 * @param options as createCardGrid.
 *
 * @returns as createCardGrid.
 */
function createSubmissionCardGrid(options = {}) {
  return createCardGrid({
    buildCards: buildSubmissionCards,
    noun: "submission",

    ...options,
  });
}

export { createSubmissionCardGrid };
