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
import { buildFailureMessage } from "../components/messages.js";
import { renderHtml } from "../core/render.js";
import { toSuiteGroups } from "../core/metricGroups.js";
import {
  buildStaticLeaderboardTable,
  toLeaderboardRows,
} from "../tables/leaderboardTable.js";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const PREVIEW_LIMIT = 5;

// ─── RENDERING ───────────────────────────────────────────────────────────────

function renderPreview(standings, tasks) {
  renderHtml(
    "lb-table-preview",
    buildStaticLeaderboardTable({
      standings,
      tasks,
      limit: PREVIEW_LIMIT,
      // The same place the section heading's "Full leaderboard" link goes.
      viewAll: { href: "/html/leaderboard/leaderboard.html" },
    }),
  );
}

// `rows.length` is one per model — the payload's own grain. The submission count has to be
// summed off the rows, each of which knows how many stand behind it, since a model
// submitted twice is still one row.
function renderStats(rows) {
  const submissions = rows.reduce((total, row) => total + row.nSubmissions, 0);

  document.getElementById("stat-submissions").textContent = submissions;
  document.getElementById("stat-models").textContent = rows.length;
}

// Into the preview's own slot, which takes the footer count with it — a failure written
// where a number goes would read as one.
function showFailedPreview(message, error) {
  renderHtml(
    document.getElementById("lb-table-preview"),
    buildFailureMessage(message, error),
  );
}

// ─── INITIALISATION ──────────────────────────────────────────────────────────

async function loadLandingPage() {
  try {
    // The task table supplies the preview's columns; the leaderboard supplies its rows.
    const [standings, tasks] = await Promise.all([
      getLeaderboard(),
      getTasks(),
    ]);

    if (!standings || !tasks) {
      showFailedPreview("Loading the leaderboard failed.");
      return;
    }

    renderPreview(standings, tasks);

    // Every row, not the five on screen: the stats are totals.
    renderStats(toLeaderboardRows(standings, toSuiteGroups(tasks)));
  } catch (err) {
    console.error("Failed to initialise the landing page:", err);
    showFailedPreview("Loading the leaderboard failed.", err);
  }
}

loadLandingPage();
