// One card per submission, for the submission list and the model dashboard.
//
// Built from a submission *row* — tables/submissionTable.js's toSubmissionRows — not from
// the API record, so that the cards, the filters above them and the table beside them all
// read one shape. The suites are already worked out there.

import { formatDate } from "../core/utils.js";
import { escapeHtml } from "../core/html.js";
import { buildStatusBadge, buildSuiteBadgeList } from "../components/badges.js";
import { createCardGrid } from "./cardGrid.js";

function buildSubmissionCards(submissions) {
  return submissions
    .map(
      (submission) => `
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
      `,
    )
    .join("");
}

/** @param options as createCardGrid. */
function createSubmissionCardGrid(options) {
  return createCardGrid({
    buildCards: buildSubmissionCards,
    noun: "submission",

    ...options,
  });
}

export { buildSubmissionCards, createSubmissionCardGrid };
