import { getSubmissions } from "./submissionApi.js";
import {escapeHtml, formatDate} from "../utils.js";
import {buildStatusBadge, buildSuiteCoverageBadges, suitesOf} from "../utils/score-cards.js";
import {renderSubmissionsTable} from "../tables/submissions.js";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

// Cards carry more here than on the models list — a status badge and a suite coverage
// row on top of the names — so they run out of room sooner.
const MAX_CARDS = 10;

// ─── RENDERING ──────────────────────────────────────────────────────────────

// showModel because this list spans every model the caller can see, so "which model is
// this?" is the column doing the most work.
function renderSubmissionTable(submissions) {
  renderSubmissionsTable({
    container: document.getElementById("submission-list"),
    submissions,
    showModel: true,
  });
}

function renderSubmissionCards(submissions) {
  const submissionList = document.getElementById("submission-list")

  submissionList.className = 'grid-2'
  submissionList.innerHTML = buildSubmissionCards(submissions);
}

function buildSubmissionCards(submissions) {

  return submissions.map(submission => `
    <a class="card column left gap-md" href="/html/submissions/submission_dashboard.html?id=${encodeURIComponent(submission.id)}">
      <div class="column left">
        <p class="title">${escapeHtml(submission.label)}</p>
        <p class="metadata">${escapeHtml(submission.model_name || "—")} · ${escapeHtml(submission.team_name || "—")}</p>
      </div>

      ${buildStatusBadge(submission.status)}

      <div class="row left gap-sm">
        ${buildSuiteCoverageBadges(suitesOf(submission))}
      </div>

      <p class="metadata">Updated ${escapeHtml(formatDate(submission.updated_at))}</p>
    </a>
  `).join("");
}


// ─── VIEW TOGGLE ─────────────────────────────────────────────────────────────

const VIEWS = {
  "view-cards": renderSubmissionCards,
  "view-table": renderSubmissionTable,
};


function viewButtons() {
  return Object.keys(VIEWS).map(id => document.getElementById(id)).filter(Boolean);
}


function setActiveView(activeId) {
  for (const button of viewButtons()) {
    button.classList.toggle("primary", button.id === activeId);
  }
}

function attachViewToggle(submissions) {
  for (const [id, render] of Object.entries(VIEWS)) {
    document.getElementById(id)?.addEventListener("click", () => {
      setActiveView(id);
      render(submissions);
    });
  }
}

// ─── INITIALISATION ──────────────────────────────────────────────────────────────
async function loadSubmissionListPage() {

  const submissions = await getSubmissions();
  if (!submissions) {
    return
  }

  const submissionList = document.getElementById("submission-list")

  if (submissions.length === 0) {
    submissionList.replaceChildren();
    viewButtons().forEach(button => { button.hidden = true; });
    return
  }

  const initialView = submissions.length <= MAX_CARDS ? "view-cards" : "view-table";

  setActiveView(initialView);
  VIEWS[initialView](submissions);
  attachViewToggle(submissions);
}


loadSubmissionListPage();
