// Page entry for index.html — the two counts across the top, and the metrics on the suite
// cards below them.
//
// #stat-submissions and #stat-models both start at "—", so a failed load leaves them
// saying nothing rather than saying zero. The metrics need no request at all.

import { getElement, renderHtml, setText } from "../core/render.js";
import { metricsForSuite } from "../core/suites.js";
import { getStats } from "../api/metaApi.js";
import { buildMetricBadgeList } from "../components/badges.js";
import { buildCount } from "../components/count.js";

// Each suite card's badge row, named by the suite it is for.
const SUITE_METRICS_ATTRIBUTE = "data-suite-metrics";

function renderStats({ n_models, n_submissions }) {
  setText("stat-submissions", n_submissions);
  setText("stat-models", n_models);
}

// The count the invitation leads with, revealed only once there is one — see its `hidden` in
// index.html. `buildCount` so a benchmark with one submitted model does not say "1 models".
function renderCtaCount(nModels) {
  const count = getElement("cta-count");

  setText(count, `${buildCount(nModels, "model")} submitted so far`);

  count.hidden = false;
}

// From the same map every metric badge in the app reads — see METRIC_NAMES in core/suites.js.
// The cards used to name their own, and had drifted from what the scorers write.
function renderSuiteMetrics() {
  for (const row of document.querySelectorAll(`[${SUITE_METRICS_ATTRIBUTE}]`)) {
    renderHtml(row, buildMetricBadgeList(metricsForSuite(row.dataset.suiteMetrics)));
  }
}

async function loadLandingPage() {
  renderSuiteMetrics();

  // Undefined when the fetch failed, which getStats has already logged.
  const stats = await getStats();

  if (!stats) return;

  renderStats(stats);
  renderCtaCount(stats.n_models);
}

loadLandingPage();
