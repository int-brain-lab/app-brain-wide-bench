// Page entry for html/leaderboard/leaderboard.html.
//
// Thin, like modelList.js and submissionList.js: fetch, then hand the payload to the table
// module. The rows, columns, controls and the grouping/metric behaviour are all in
// leaderboardTable.js; the fetch is in leaderboardApi.js.

import { getLeaderboard } from "../api/leaderboardApi.js";
import { isAuthenticated } from "../api/client.js";
import { renderLeaderboardTable } from "../tables/leaderboardTable.js";
import { applyShell } from "../templates/shell.js";
import { renderMessage } from "../core/utils.js";


// ─── RENDERING ──────────────────────────────────────────────────────────────

function showError(message) {
  renderMessage(document.getElementById("leaderboard"), message, "error-msg");
}


// ─── INITIALISATION ─────────────────────────────────────────────────────────

async function loadLeaderboardPage() {
  try {
    // Before the fetch, so the page settles into one shell rather than rearranging itself
    // around the table once the rows land.
    applyShell(await isAuthenticated());

    const submissions = await getLeaderboard();

    if (!submissions) {
      showError("Could not load the leaderboard.");
      return;
    }

    // An empty payload isn't an error — nothing public has been scored yet — but the table
    // would render a filter bar over nothing, so it says so instead.
    if (submissions.length === 0) {
      showError("No public submissions have been scored yet.");
      return;
    }

    renderLeaderboardTable({ container: "leaderboard", submissions });
  } catch (err) {
    console.error("Failed to initialise the leaderboard:", err);
    showError("Something went wrong.");
  }
}

loadLeaderboardPage();
