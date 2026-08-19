// One card per model, for the model list and the team dashboard.

import { escapeHtml, formatDate } from "../core/utils.js";
import {buildSuiteBadgeList, buildVisibleBadge} from "../components/badges.js";
import { buildCount } from "../components/count.js";


function buildModelCard(model) {
  const submissionCount = model.n_submissions ?? 0;

  return `
    <a
      class="card column left gap-md"
      href="/html/models/models.html?id=${encodeURIComponent(model.id)}"
    >
      <div class="column left">
        <p class="title">${escapeHtml(model.name)}</p>
        <p class="metadata">${escapeHtml(model.team_name || "—")}</p>
      </div>

      <div class="row left gap-md">
        ${buildSuiteBadgeList(model.task_suites ?? [], "sm")}
      </div>

      <p class="metadata">
        ${buildCount(submissionCount, "submission")}
        · Created ${escapeHtml(formatDate(model.created_at))}
      </p>
    </a>
  `;
}

function buildModelCards(models) {
  return models
    .map(buildModelCard)
    .join("");
}


export { buildModelCards };
