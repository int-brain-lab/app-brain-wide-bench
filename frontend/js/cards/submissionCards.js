// One card per submission, for the submission list and the model dashboard.

import { escapeHtml, formatDate } from "../core/utils.js";
import { buildStatusBadge, buildSuiteCoverageBadges } from "../components/badges.js";
import { suitesFromSubmission } from "../core/suites.js";


function buildSubmissionCards(submissions) {
  return submissions
    .map(
      submission => `
        <a
          class="card column left gap-sm"
          href="/html/submissions/submissions.html?id=${encodeURIComponent(submission.id)}"
        >
          <div class="column left">
            <p class="title">${escapeHtml(submission.label)}</p>
            <p class="metadata">
              ${escapeHtml(submission.model_name || "—")} ·
              ${escapeHtml(submission.team_name || "—")}
            </p>
          </div>

          ${buildStatusBadge(submission.status)}

          <div class="row left gap-sm">
            ${buildSuiteCoverageBadges(suitesFromSubmission(submission))}
          </div>

          <p class="metadata">
            Updated ${escapeHtml(formatDate(submission.updated_at))}
          </p>
        </a>
      `,
    )
    .join("");
}


export { buildSubmissionCards };
