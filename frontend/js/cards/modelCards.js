// One card per model, for the model list and the team dashboard.
//
// Built from a model row — utils/modelUtils.js's toModelRows — so the cards, the filters
// above them and the table beside them read one shape.

import { escapeHtml } from "../core/html.js";
import { hrefForRecord } from "../core/links.js";
import { formatDate } from "../core/utils.js";
import { buildMineBadge, buildPretrainedBadge, buildSuiteBadgeList } from "../components/badges.js";
import { buildCount } from "../components/count.js";
import { createCardGrid } from "./cardGrid.js";

const MODEL_PAGE = "/html/models/models.html";

// `showMine` marks the cards on the viewer's own teams, for a listing that mixes them
// with everyone else's. Off by default: on a listing that is all theirs it says nothing.
// `showTeam` off for a listing that is all one team's, where naming it on every card would
// only repeat the page's own heading.
function buildModelCard(model, { showMine = false, showTeam = true } = {}) {
  const submissionCount = model.n_submissions ?? 0;

  return `
    <a
      class="card column left gap-lg"
      href="${hrefForRecord(MODEL_PAGE, model.id, { mine: model.is_mine })}"
    >
      <div class="column left">
        <p class="label">${escapeHtml(model.name)}</p>
        ${showTeam ? `<p class="metadata">${escapeHtml(model.team_name || "—")}</p>` : ""}
      </div>

      <div class="row left gap-lg">
        ${buildSuiteBadgeList(model.suites ?? [], "sm")}
        ${buildPretrainedBadge(model.is_pretrained)}
        ${showMine ? buildMineBadge(model.is_mine) : ""}
      </div>

      <p class="metadata">
        ${buildCount(submissionCount, "submission")}
        · Created ${escapeHtml(formatDate(model.created_at))}
      </p>
    </a>
  `;
}

function buildModelCards(models, options) {
  return models.map((model) => buildModelCard(model, options)).join("");
}

/**
 * The model card grid, built once and kept.
 *
 * @param showMine as buildModelCard.
 * @param showTeam as buildModelCard.
 * @param options  the rest, as createCardGrid.
 *
 * @returns as createCardGrid.
 */
function createModelCardGrid({ showMine = false, showTeam = true, ...options } = {}) {
  return createCardGrid({
    buildCards: (rows) => buildModelCards(rows, { showMine, showTeam }),
    noun: "model",

    ...options,
  });
}

export { buildModelCards, createModelCardGrid };
