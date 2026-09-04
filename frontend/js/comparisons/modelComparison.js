// Several models side by side, as the record comparison reads them.
//
// The preset, not the widget: the tabs, the plots, the differences and the task panel are
// recordComparison.js, and this is only what makes them a comparison of *models* — the nine
// specification fields the details panel shows, and where a model's scores come from.
//
// Two hosts mount it: the leaderboard, which passes its own scores off the board it is already
// showing, and the compare page, which lets it fetch them.

import { createRecordComparison } from "./recordComparison.js";
import { displayValue } from "../forms/fields.js";
import { loadModelBreakdown } from "../api/modelApi.js";
import { MODEL_FIELDS } from "../schemas/modelSchema.js";
import { fieldsForPanel } from "../schemas/schemaPanels.js";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

// Also the compare page's cap, and the models list's.
const MAX_MODELS = 6;

// ─── DETAILS ─────────────────────────────────────────────────────────────────

// Every specification field, not the editable ones: this is a reading of the model, so a
// field the reader could never set still says something about it.
function detailKeys() {
  return fieldsForPanel(MODEL_FIELDS, "specification", false);
}

// Null until this model's request lands, which the grid draws as a dash — "not known yet" and
// "not set" look the same in a cell, and both are the absence of an answer.
function valueOf(detail, key) {
  if (!detail) return null;

  const value = displayValue(MODEL_FIELDS[key], detail[key]);

  return value == null || value === "" ? null : String(value);
}

const DETAILS = {
  // Read on every render rather than once: loadModelMeta fills the schema in place, so a list
  // built at module load would be built before there was anything to build it from.
  attributes: () =>
    detailKeys().map((key) => ({
      key,
      label: MODEL_FIELDS[key]?.label ?? key,
    })),

  cells: (entry) =>
    Object.fromEntries(
      detailKeys().map((key) => [key, { value: valueOf(entry.detail, key) }]),
    ),
};

// ─── ENTRIES ─────────────────────────────────────────────────────────────────

// For a host whose rows came from toModelRows. The leaderboard's are standings, and it
// passes its own.
function toModelEntry(row) {
  return {
    key: row.id,
    recordId: row.id,
    name: row.name,
    teamName: row.team_name,
  };
}

// ─── WIDGET ──────────────────────────────────────────────────────────────────

/**
 * @param rest as createRecordComparison. `scoresOf` defaults to the breakdown fetched below;
 *             a host holding the scores already passes its own.
 */
function createModelComparison(options) {
  return createRecordComparison({
    noun: "model",
    max: MAX_MODELS,
    details: DETAILS,

    toEntry: toModelEntry,

    // The breakdown rather than the whole model: the same specification fields, the collapse
    // done by the server that does the ranking, and the methodology of each entry — which is
    // what the plots put in their tooltips. Without the submission tree, which is tens of
    // kilobytes of per-recording detail nothing here draws.
    //
    // `taskSubmissionIds` where the host knows which entries it means — a leaderboard row
    // names the ones it ranked — so a filtered board and this describe the same runs.
    loadDetail: (entry) =>
      loadModelBreakdown(entry.recordId, {
        taskSubmissionIds: entry.taskSubmissionIds,
      }),

    // What the breakdown calls them, for a host that left the fetch to this.
    scoresOf: (entry) => entry.detail?.tasks ?? null,

    ...options,
  });
}

export { MAX_MODELS, createModelComparison };
