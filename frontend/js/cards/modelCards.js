// One card per model, for the model list and the team dashboard.
//
// Built from a model row — utils/modelUtils.js's toModelRows — so the cards, the filters
// above them and the table beside them read one shape.

import { escapeHtml } from "../core/html.js";
import { formatDate } from "../core/utils.js";
import {
  buildMineBadge,
  buildPretrainedBadge,
  buildSuiteBadgeList,
} from "../components/badges.js";
import { buildCount } from "../components/count.js";
import { createCardGrid } from "./cardGrid.js";

// `showMine` marks the cards on the viewer's own teams, for a listing that mixes them
// with everyone else's. Off by default: on a listing that is all theirs it says nothing.
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
  return models.map((model) => buildModelCard(model, options)).join("");
}

/**
 * The model card grid, built once and kept.
 *
 * @param showMine as buildModelCard.
 * @param options  the rest, as createCardGrid.
 *
 * @returns as createCardGrid.
 */
function createModelCardGrid({ showMine = false, ...options } = {}) {
  return createCardGrid({
    buildCards: (rows) => buildModelCards(rows, { showMine }),
    noun: "model",

    ...options,
  });
}

export { createModelCardGrid };
