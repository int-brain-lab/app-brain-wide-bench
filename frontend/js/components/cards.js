import {escapeHtml, formatDate} from "../utils.js";
import {buildStatusBadge, buildSuiteCoverageBadges} from "./badges.js"
import { suitesFromSubmission } from "../utils/suites.js";


function buildCount(count, noun) {
  return `${count ?? 0} ${noun}${(count ?? 0) === 1 ? "" : "s"}`;
}


// ─── MODEL CARDS ─────────────────────────────────────────────────────────

function buildModelCard(model) {
  const submissionCount = model.n_submissions ?? 0;

  return `
    <a
      class="card column left gap-sm"
      href="/html/models/models.html?id=${encodeURIComponent(model.id)}"
    >
      <div class="column left">
        <p class="title">${escapeHtml(model.name)}</p>
        <p class="metadata">${escapeHtml(model.team_name || "—")}</p>
      </div>

      <div class="row left gap-md">
        ${buildSuiteCoverageBadges(model.task_suites ?? [])}
      </div>

      <p class="metadata">
        ${buildCount(submissionCount, "submission")}
        · Created ${escapeHtml(formatDate(model.created_at))}
      </p>
    </a>
  `;
}

function buildModelCards(models) {
  return models
    .map(buildModelCard)
    .join("");
}

// ─── SUBMISSION CARDS ─────────────────────────────────────────────────────────
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


// ─── TEAM CARDS ─────────────────────────────────────────────────────────

function buildTeamCards(teams) {

  return teams.map(team => `
    <a 
    class="card column left gap-sm"
    href="/html/teams/teams.html?id=${encodeURIComponent(team.id)}"
    >
      <p class="title">${escapeHtml(team.name)}</p>
      <p class="metadata">${buildCount(team.n_members, "member")}</p>
      <p class="metadata">${buildCount(team.n_models, "model")}</p>
    </a>
  `).join("");
}


// ─── STAT CARDS ─────────────────────────────────────────────────────────
function buildStatCard([label, value, icon]) {
  return `
    <div class="stat-card gap-sm">
      <div class="row gap-md">
        <i class="stat-icon" data-lucide="${escapeHtml(icon)}"></i>
        <p class="statistic">${escapeHtml(value)}</p>
      </div>
      <p class="metadata">${escapeHtml(label).toUpperCase()}</p>
    </div>`;
}

function buildStatCards(statistics) {
  return statistics
    .map(buildStatCard).join("");
}




export {
  buildModelCards,
  buildTeamCards,
  buildStatCards,
  buildSubmissionCards,
  buildCount
}
