// Page entry for index.html — the public landing page: two counts and a five-row
// leaderboard preview.
//
// The preview is the leaderboard table's own static renderer, so the rank medals, the
// model cell and the score formatting are written once and shared with the full page.
//
// The page provides:
//   #lb-table-preview   where the table is rendered — the count is in its own footer
//   #stat-submissions #stat-models

import { getLeaderboard } from "../api/leaderboardApi.js";
import { getTasks } from "../api/taskApi.js";
import { showFailure } from "../core/utils.js";
import { renderStaticLeaderboardTable } from "../tables/leaderboardTable.js";


// ─── CONSTANTS ──────────────────────────────────────────────────────────────

const PREVIEW_LIMIT = 5;


// ─── RENDERING ──────────────────────────────────────────────────────────────

// Returns every row, not the five it rendered — the model stat is a total, and so is the
// count the table puts in its footer.
function renderPreview(submissions, tasks) {
  return renderStaticLeaderboardTable({
    container: "lb-table-preview",
    submissions,
    tasks,
    limit: PREVIEW_LIMIT,
    // The same place the section heading's "Full leaderboard" link goes.
    viewAll: { href: "/html/leaderboard/leaderboard.html" },
  });
}

// `submissions.length` is every public scored submission; `rows.length` is one per
// (model, team), so the two differ whenever a model has been submitted more than once.
function renderStats(rows, submissions) {
  document.getElementById("stat-submissions").textContent = submissions.length;
  document.getElementById("stat-models").textContent = rows.length;
}

// Into the preview's own slot, which takes the footer count with it — a failure written
// where a number goes would read as one.
function showFailedPreview(message, error) {
  showFailure(document.getElementById("lb-table-preview"), message, error);
}


// ─── INITIALISATION ─────────────────────────────────────────────────────────

async function loadLandingPage() {
  try {
    // The task table supplies the preview's columns; the leaderboard supplies its rows.
    const [submissions, tasks] = await Promise.all([getLeaderboard(), getTasks()]);

    if (!submissions || !tasks) {
      showFailedPreview("Loading the leaderboard failed.");
      return;
    }

    renderStats(renderPreview(submissions, tasks), submissions);
  } catch (err) {
    console.error("Failed to initialise the landing page:", err);
    showFailedPreview("Loading the leaderboard failed.", err);
  }
}

loadLandingPage();
