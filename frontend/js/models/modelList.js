import { getMyModels } from "./modelApi.js";
import {escapeHtml, formatDate} from "../utils.js";
import {buildSuiteCoverageBadges} from "../utils/score-cards.js";
import {renderModelsTable} from "../tables/models.js";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const MAX_CARDS = 6;

// ─── RENDERING ──────────────────────────────────────────────────────────────

function renderModelTable(models) {
  renderModelsTable({ container: document.getElementById("models-list"), models });
}

function renderModelCards(models) {
  const modelList = document.getElementById("models-list")

  modelList.className = 'grid-2'
  modelList.innerHTML = buildModelCards(models);
}

function buildModelCards(models) {

  return models.map(model => `
    <a class="card column left gap-sm" href="/html/models/model_dashboard.html?id=${encodeURIComponent(model.id)}">
      <div class="column left">
        <p class="title">${escapeHtml(model.name)}</p>
        <p class="metadata">${escapeHtml(model.team_name || "—")}</p>
      </div>
      <div class="row left gap-md">
        ${buildSuiteCoverageBadges(model.task_suites ?? [])}
      </div>
      <p class="metadata">${model.n_submissions ?? 0} submission${(model.n_submissions ?? 0) === 1 ? "" : "s"} · Created ${escapeHtml(formatDate(model.created_at))}</p>
    </a>
  `).join("");
}


// ─── VIEW TOGGLE ─────────────────────────────────────────────────────────────

const VIEWS = {
  "view-cards": renderModelCards,
  "view-table": renderModelTable,
};


function viewButtons() {
  return Object.keys(VIEWS).map(id => document.getElementById(id)).filter(Boolean);
}


function setActiveView(activeId) {
  for (const button of viewButtons()) {
    button.classList.toggle("primary", button.id === activeId);
  }
}

function attachViewToggle(models) {
  for (const [id, render] of Object.entries(VIEWS)) {
    document.getElementById(id)?.addEventListener("click", () => {
      setActiveView(id);
      render(models);
    });
  }
}

// ─── INITIALISATION ──────────────────────────────────────────────────────────────
async function loadModelListPage() {

  const models = await getMyModels();
  if (!models) {
    return
  }

  const modelList = document.getElementById("models-list")

  if (models.length === 0) {
    modelList.replaceChildren();d.
    viewButtons().forEach(button => { button.hidden = true; });
    return
  }

  const initialView = models.length <= MAX_CARDS ? "view-cards" : "view-table";

  setActiveView(initialView);
  VIEWS[initialView](models);
  attachViewToggle(models);
}


loadModelListPage();
