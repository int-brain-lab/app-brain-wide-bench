// The two panels a task-scores list opens beside its rows: a breakdown of the selected
// score, and a comparison of several at once — see templates/listView.js for the shape.

import {
  bindTableDetail,
  createTaskBreakdown,
} from "../widgets/taskBreakdown.js";
import { createTaskComparison } from "./taskScoreComparison.js";

const BROWSE_PROMPT =
  "Select a task score in the table to see how it was measured.";

// What either panel needs to start on a row: the rest — the breakdown, the methodology —
// each fetches for itself.
function toScoreEntry(row) {
  return {
    key: row.id,
    taskId: row.task_id,
    submissionId: row.submission_id,
    submissionLabel: row.submission_label,
    modelName: row.model_name,
    metric: row.metric,
  };
}

// One row at a time in browse mode, six in compare.
const SCORE_MODES = {
  base: {
    create: (container) =>
      createTaskBreakdown({ container, prompt: BROWSE_PROMPT }),
    bindTable: (breakdown) => bindTableDetail(breakdown, toScoreEntry),
  },

  active: {
    label: "Compare tasks",
    title: "Compare task scores",
    create: (container) =>
      createTaskComparison({ container, toEntry: toScoreEntry }),
  },
};

export { SCORE_MODES };
