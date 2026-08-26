// One card per model, for the model list and the team dashboard.
//
// Built from a model *row* — tables/modelTable.js's toModelRows — not from the API record,
// so that the cards, the filters above them and the table beside them all read one shape.

import { escapeHtml, formatDate } from "../core/utils.js";
import {buildMineBadge, buildPretrainedBadge, buildSuiteBadgeList, buildVisibleBadge} from "../components/badges.js";
import { buildCount } from "../components/count.js";


// `showMine` on marks the cards on the viewer's own teams, for the public listing that
// mixes them with everyone else's. Off by default, so the dashboard and "My models" — where
// every card is theirs — don't badge every one of them.
function buildModelCard(model, { showMine = false } = {}) {
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
        ${buildSuiteBadgeList(model.suites ?? [], "sm")}
        ${buildPretrainedBadge(model.is_pretrained, "sm")}
        ${showMine ? buildMineBadge(model.is_mine, "sm") : ""}
      </div>

      <p class="metadata">
        ${buildCount(submissionCount, "submission")}
        · Created ${escapeHtml(formatDate(model.created_at))}
      </p>
    </a>
  `;
}

function buildModelCards(models, options) {
  return models
    .map(model => buildModelCard(model, options))
    .join("");
}


export { buildModelCards };
