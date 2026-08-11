// Page entry for index.html — the public landing page: two counts and a five-row
// leaderboard preview.
//
// The preview goes through renderStaticTable with columns borrowed from
// leaderboard/leaderboardTable.js, the same arrangement modelDashboard.js uses for its
// recent-submissions preview. It used to hand-write its own <tr>/<td> markup against a
// <table> in index.html, which meant the rank medals, the model cell and the score
// formatting were all written twice — once here and once on the leaderboard.
//
// The page provides:
//   #lb-table-preview   where the table is rendered
//   #lb-table-count     "N models", or the error
//   #stat-submissions #stat-models

import { getLeaderboard } from "./leaderboard/leaderboardApi.js";
import { leaderboardPreviewColumns, toRows } from "./leaderboard/leaderboardTable.js";
import { renderStaticTable } from "./utils/tables.js";


// ─── CONSTANTS ──────────────────────────────────────────────────────────────

const PREVIEW_LIMIT = 5;


// ─── RENDERING ──────────────────────────────────────────────────────────────

// By `rank`, which toRows has already assigned by overall — this page has no metric
// selector of its own, so the leaderboard's default order is the only one it shows.
function renderPreview(rows) {
  const topRows = rows
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .slice(0, PREVIEW_LIMIT);

  document.getElementById("lb-table-preview").innerHTML = renderStaticTable({
    columns: leaderboardPreviewColumns(),
    rows: topRows,
  });

  document.getElementById("lb-table-count").textContent = `${rows.length} models`;
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

    const rows = toRows(submissions);

    renderPreview(rows);
    renderStats(rows, submissions);
  } catch (err) {
    console.error("Failed to initialise the landing page:", err);
    showError("Could not load leaderboard.");
  }
}

loadLandingPage();
