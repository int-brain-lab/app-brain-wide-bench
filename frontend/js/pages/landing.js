// Page entry for index.html — the two counts across the top of the public landing page.
//
// #stat-submissions and #stat-models both start at "—", so a failed load leaves them
// saying nothing rather than saying zero.

import { getLeaderboard } from "../api/leaderboardApi.js";

// One standing per model — the payload's own grain. The submission count is summed off
// them, since a model submitted twice is still one standing.
function renderStats(standings) {
  const submissions = standings.reduce(
    (total, standing) => total + (standing.n_submissions ?? 0),
    0,
  );

  document.getElementById("stat-submissions").textContent = submissions;
  document.getElementById("stat-models").textContent = standings.length;
}

async function loadLandingPage() {
  // Undefined when the fetch failed, which getLeaderboard has already logged.
  const standings = await getLeaderboard();

  if (standings) renderStats(standings);
}

loadLandingPage();
