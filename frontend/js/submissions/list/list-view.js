import {escapeHtml, formatDate} from "../../utils.js";
import {buildStatusBadge, buildSuiteBadges} from "../../utils/score-cards.js";

function renderSubmissionList(submissions) {

  const submissionList = document.getElementById("submission-list")

  if (submissions.length === 0) {
    submissionList.replaceChildren();
    return
  }

  if (submissions.length <= 6) {
    submissionList.classList = 'grid-3'
    submissionList.innerHTML = buildSubmissionCards(submissions);
    return
  }

  submissionList.classList = 'table'
  submissionList.innerHTML = buildSubmissionTable(submissions);
}



function buildSubmissionCards(submissions) {
  return submissions.map(submission => `
    <a class="card secondary column left gap-lg" href="submission_details.html?id=${encodeURIComponent(submission.id)}">
      <p class="label">${escapeHtml(submission.label)}</p>
      <div class="column left gap-md">
        <p class="metadata">Team: ${escapeHtml(submission.team_name || "—")}</p>
        <p class="metadata">Model: ${escapeHtml(submission.model_name || "—")}</p>
        <p class="metadata">Created: ${escapeHtml(formatDate(submission.created_at))}</p>
      </div>
    </a>
  `).join("");
}


function buildSubmissionRow(submission) {
  return `
    <tr>
      <td><a href="submission_details.html?id=${encodeURIComponent(submission.id)}">${escapeHtml(submission.label)}</a></td>
      <td>${escapeHtml(submission.model_name ?? submission.model ?? "—")}</td>
      <td>${escapeHtml(formatDate(submission.updated_at))}</td>
      <td>${buildStatusBadge(submission.status)}</td>
      <td><span class="row left gap-sm">${buildSuiteBadges(submission)}</span></td>
    </tr>`;
}


function buildSubmissionTable(submissions) {
  return `
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Model</th>
          <th>Created</th>
          <th>Status</th>
          <th>Suites</th>
        </tr>
      </thead>
      <tbody>
        ${submissions.map(submission => buildSubmissionRow(submission)).join("")}
      </tbody>
    </table>
  `;
}


export { renderSubmissionList };
