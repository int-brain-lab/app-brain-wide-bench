// Page entry for index.html — the public landing page: two counts and a five-row
// leaderboard preview.
//
// The preview is the leaderboard table's own static renderer, so the rank medals, the
// model cell and the score formatting are written once and shared with the full page.
//
// The page provides:
//   #lb-table-preview   where the table is rendered
//   #lb-table-count     "N models", or the error
//   #stat-submissions #stat-models

import { getLeaderboard } from "../api/leaderboardApi.js";
import { renderStaticLeaderboardTable } from "../tables/leaderboardTable.js";


// ─── CONSTANTS ──────────────────────────────────────────────────────────────

const PREVIEW_LIMIT = 5;


// ─── RENDERING ──────────────────────────────────────────────────────────────

// Returns every row, not the five it rendered — the count below the preview and the
// model stat are both totals.
function renderPreview(submissions) {
  const rows = renderStaticLeaderboardTable({
    container: "lb-table-preview",
    submissions,
    limit: PREVIEW_LIMIT,
  });

  document.getElementById("lb-table-count").textContent = `${rows.length} models`;

  return rows;
}

// `submissions.length` is every public scored submission; `rows.length` is one per
// (model, team), so the two differ whenever a model has been submitted more than once.
function renderStats(rows, submissions) {
  document.getElementById("stat-submissions").textContent = submissions.length;
  document.getElementById("stat-models").textContent = rows.length;
}

function showError(message) {
  document.getElementById("lb-table-count").textContent = message;
}


// ─── INITIALISATION ─────────────────────────────────────────────────────────

async function loadLandingPage() {
  try {
    const submissions = await getLeaderboard();

    if (!submissions) {
      showError("Could not load leaderboard.");
      return;
    }

    renderStats(renderPreview(submissions), submissions);
  } catch (err) {
    console.error("Failed to initialise the landing page:", err);
    showError("Could not load leaderboard.");
  }
}

loadLandingPage();
