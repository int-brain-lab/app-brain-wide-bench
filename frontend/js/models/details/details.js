import { attachTabEvents, showTab } from "../../tab.js";
import { loadModel } from "../api.js";
import { loadModelFields } from "../schema.js";
import { attachButtonEvents } from "../edit/edit.js";
import { countTasks, getMeanScores, scoresBySuite } from "../../scores.js";
import {
  renderDetailsTab,
  renderEvaluationTab,
  renderModelHeader,
  renderOverviewTab,
  renderSubmissionsTab,
} from "./details-view.js";

function seeAllDetailsLink() {
  return document.getElementById("see-all-details-link");
}

function attachSeeAllDetailsLink() {
  seeAllDetailsLink()?.addEventListener("click", () => showTab("details"));
}


async function initialiseOverview(model) {
  try {
    const submissions = model.submissions;
    const fields = await loadModelFields();

    const suiteScores = scoresBySuite(submissions);
    const meanScores = getMeanScores(suiteScores);
    const taskCount = countTasks(suiteScores);
    const ranks = { ts1: 1, ts2: 3, ts3: 8, overall: 3 };

    renderModelHeader(model);
    renderOverviewTab({ model, fields, submissions, meanScores, ranks, taskCount });
    renderDetailsTab(model, fields);
    renderSubmissionsTab(submissions);
    renderEvaluationTab(suiteScores);

    if (globalThis.lucide?.createIcons) {
      globalThis.lucide.createIcons();
    }

    attachTabEvents();
    attachSeeAllDetailsLink();
  } catch (err) {
    console.error(err);
  }
}

async function loadModelDetailsPage() {
  const modelId = new URLSearchParams(location.search).get("id") || "2058ace8-6e23-4815-8eb2-d6b8f3ae40c7";
  const model = await loadModel(modelId);

  await initialiseOverview(model);
  await attachButtonEvents(model, async () => initialiseOverview(model));
}

loadModelDetailsPage();
