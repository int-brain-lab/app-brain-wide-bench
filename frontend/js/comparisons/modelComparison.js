// Several models side by side, as the record comparison reads them.
//
// The preset, not the widget: what makes recordComparison.js a comparison of *models* — the
// specification fields the details panel shows, and where a model's scores come from.

import { suitesFromModel } from "../core/suites.js";
import { loadModelBreakdown } from "../api/modelApi.js";
import { MODEL_FIELDS } from "../schemas/modelSchema.js";
import { fieldsForPanel } from "../schemas/schemaPanels.js";
import { buildSuiteBadgeList } from "../components/badges.js";
import { displayValue } from "../forms/fields.js";
import { createRecordComparison } from "./recordComparison.js";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

// Also the compare page's cap, and the models list's.
const MAX_MODELS = 6;

// ─── DETAILS ─────────────────────────────────────────────────────────────────

// Ahead of the specification, and off the breakdown rather than the schema: whose model this
// is and what it has been scored on are what tell two rows apart before any number is read.
const TEAM = "team_name";
const TASK_SUITES = "task_suites";

const OWN_ATTRIBUTES = [
  { key: TEAM, label: "Team" },
  { key: TASK_SUITES, label: "Task suites" },
];

// Every specification field, editable or not.
function detailKeys() {
  return fieldsForPanel(MODEL_FIELDS, "specification", false);
}

function ownCells(detail) {
  const suites = detail ? suitesFromModel(detail) : [];

  return {
    [TEAM]: { value: detail?.team_name ?? null },
    // Empty markup for a model with no suites, which the grid draws as a dash.
    [TASK_SUITES]: { html: buildSuiteBadgeList(suites, "sm") },
  };
}

// Null until the fetch lands, which the grid draws as a dash.
function valueOf(detail, key) {
  if (!detail) return null;

  const value = displayValue(MODEL_FIELDS[key], detail[key]);

  return value == null || value === "" ? null : String(value);
}

const DETAILS = {
  // loadModelMeta fills MODEL_FIELDS in place, so this cannot be built at module load.
  attributes: () => [
    ...OWN_ATTRIBUTES,
    ...detailKeys().map((key) => ({
      key,
      label: MODEL_FIELDS[key]?.label ?? key,
    })),
  ],

  cells: (pick) => ({
    ...ownCells(pick.detail),
    ...Object.fromEntries(
      detailKeys().map((key) => [key, { value: valueOf(pick.detail, key) }]),
    ),
  }),
};

// ─── PICKS ───────────────────────────────────────────────────────────────────

// For a host whose rows came from toModelRows.
function toModelPick(row) {
  return {
    key: row.id,
    name: row.name,
  };
}

// ─── WIDGET ──────────────────────────────────────────────────────────────────

/**
 * A record comparison of models.
 *
 * @param options as createRecordComparison. `readScores` defaults to the breakdown fetched
 *                here; a host already holding the scores passes its own.
 * @returns the comparison — see createRecordComparison.
 */
function createModelComparison(options) {
  return createRecordComparison({
    noun: "model",
    max: MAX_MODELS,
    details: DETAILS,

    toPick: toModelPick,

    // The specification fields, the server's collapse to one entry per task, and the
    // methodology of each — without the submission tree, which nothing here draws.
    //
    // `taskSubmissionIds` where the host knows which runs it means, so a filtered board and
    // this describe the same ones.
    loadDetail: (pick) =>
      loadModelBreakdown(pick.key, {
        taskSubmissionIds: pick.taskSubmissionIds,
      }),

    // What the breakdown calls them.
    readScores: (pick) => pick.detail?.tasks ?? null,

    ...options,
  });
}

export { MAX_MODELS, createModelComparison };
