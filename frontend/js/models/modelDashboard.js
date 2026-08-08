import { loadModel } from "./modelApi.js";
import { loadModelFields } from "./modelSchema.js";
import { countTasks, getMeanScores, scoresBySuite } from "../scores.js";
import {formatDate} from "../utils.js";
import {buildStatCards, buildSuiteScoreBars} from "../utils/score-cards.js";
import {renderStaticTable} from "../tables/utils.js";
import {submissionColumns, toRow as toSubmissionRow} from "../tables/submissions.js";
import {renderDisplayFields} from "../utils/form-fields.js";


// ─── RENDERING ──────────────────────────────────────────────────────────────

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const RECENT_LIMIT = 3;

const MODEL_PAGE_LINKS = {
  "model-scores-link": "/html/models/model_scores.html",
  "model-details-link": "/html/models/model_details.html",
  "model-submissions-link": "/html/models/model_submissions.html",
};

// ─── HELPERS ────────────────────────────────────────────────────────────────
function getStatistics(submissions, meanScores, taskCount) {
  return [
    ["submissions", submissions.length, "layers"],
    ["public submissions", submissions.filter(s => s.is_public).length, "globe"],
    ["task suites", Object.keys(meanScores).length - 1, "grid-3x3"],
    ["tasks", taskCount, "list-checks"],
  ];
}

// ─── RENDERING ──────────────────────────────────────────────────────────────
function renderHeader(model) {
  document.getElementById("model-title").textContent = model.name;
  document.getElementById("model-description").textContent =
    `${model.team_name} · Created ${formatDate(model.created_at)}`;
}

function renderStats(statistics) {
  document.getElementById("model-stats").innerHTML = buildStatCards(statistics);
}

function renderScores(meanScores, ranks) {
  document.getElementById("model-scores").innerHTML = buildSuiteScoreBars(meanScores, ranks);
}

function renderSubmissions(submissions) {
  const recentSubmissions = submissions
    .slice()
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0, RECENT_LIMIT);

  document.getElementById("model-submissions").innerHTML = renderStaticTable({
    columns: submissionColumns(),
    rows: recentSubmissions.map(toSubmissionRow),
  });
}

function renderDetails(model, fields) {

  const html = `

    <div class="card row">
      <span class="column gap-md">
         ${renderDisplayFields(["team_name", 'temporal_context_s'], model, fields)}
      </span>
      <span class="column gap-md">
         ${renderDisplayFields(["created_at", 'link_code'], model, fields)}
      </span>
      <span class="column gap-md">
         ${renderDisplayFields(["team_name", 'temporal_context_s'], model, fields)}
      </span>
    
    </div>
  `
  document.getElementById("model-details").innerHTML = html;
}

// ─── EVENTS ─────────────────────────────────────────────────────────────────

function attachLinks(model) {
  for (const [id, page] of Object.entries(MODEL_PAGE_LINKS)) {
    const link = document.getElementById(id);
    if (!link) continue;

    link.href = `${page}?id=${encodeURIComponent(model.id)}`;
  }
}

// ─── INITIALISATION ─────────────────────────────────────────────────────────

async function loadModelDashboardPage() {
  try {


    const modelId = new URLSearchParams(location.search).get("id")
    const model = await loadModel(modelId);
    const submissions = model.submissions;
    const fields = await loadModelFields();

    const suiteScores = scoresBySuite(submissions);
    const meanScores = getMeanScores(suiteScores);
    const taskCount = countTasks(suiteScores);
    const ranks = { ts1: 1, ts2: 3, ts3: 8, overall: 3 };

    renderHeader(model);
    renderScores(meanScores, ranks);
    renderStats(getStatistics(submissions, meanScores, taskCount));
    renderDetails(model, fields);
    renderSubmissions(submissions);
    attachLinks(model);

    if (globalThis.lucide?.createIcons) {
      globalThis.lucide.createIcons();
    }

  } catch (err) {
    console.error(err);
  }
}

loadModelDashboardPage();
