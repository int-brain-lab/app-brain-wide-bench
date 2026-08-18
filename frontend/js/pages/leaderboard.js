// Page entry for html/leaderboard/leaderboard.html.
//
// Thin, like modelList.js and submissionList.js: fetch, then hand the payload to the table
// module. The rows, columns, controls and the grouping/metric behaviour are all in
// leaderboardTable.js; the fetch is in leaderboardApi.js.
//
// The chrome is the shared one — header, body section, message region — so the leaderboard
// reports an empty result or a failure exactly as the list pages do.

import { getLeaderboard } from "../api/leaderboardApi.js";
import { isAuthenticated } from "../api/client.js";
import { renderLeaderboardTable } from "../tables/leaderboardTable.js";
import { applyShell } from "../templates/shell.js";
import { showEmpty, showFailure } from "../core/utils.js";
import {
  buildBody,
  buildHeader,
  buildPage,
  renderHeader,
  renderPage,
  sectionBody,
  showPageError,
} from "../templates/record-page.js";


// ─── CONSTANTS ──────────────────────────────────────────────────────────────

const TITLE = "Leaderboard";
const DESCRIPTION = "Public, completed submissions scored against held-out test data.";


// ─── INITIALISATION ─────────────────────────────────────────────────────────

async function loadLeaderboardPage() {
  try {
    // Before anything renders, so the page settles into one shell rather than rearranging
    // itself around the table once the rows land.
    applyShell(await isAuthenticated());

    renderPage(
      buildPage({
        header: buildHeader(),
        body: buildBody(),
      }),
    );

    renderHeader(TITLE, DESCRIPTION);

    const submissions = await getLeaderboard();

    if (!submissions) {
      showFailure(sectionBody("body"), "Loading the leaderboard failed.");
      return;
    }

    // An empty payload isn't a failure — nothing public has been scored yet — but the table
    // would render a filter bar over nothing, so it says so instead.
    if (submissions.length === 0) {
      showEmpty(sectionBody("body"), "No public submissions have been scored yet.");
      return;
    }

    renderLeaderboardTable({ container: sectionBody("body"), submissions });
  } catch (error) {
    console.error("Failed to initialise the leaderboard:", error);

    showPageError("The leaderboard page could not be loaded.", error);
  }
}

loadLeaderboardPage();
