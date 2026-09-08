// Page entry for index.html — the two counts across the top of the public landing page.
//
// #stat-submissions and #stat-models both start at "—", so a failed load leaves them
// saying nothing rather than saying zero.

import { getStats } from "../api/metaApi.js";

function renderStats({ n_models, n_submissions }) {
  document.getElementById("stat-submissions").textContent = n_submissions;
  document.getElementById("stat-models").textContent = n_models;
}

async function loadLandingPage() {
  // Undefined when the fetch failed, which getStats has already logged.
  const stats = await getStats();

  if (stats) renderStats(stats);
}

loadLandingPage();
