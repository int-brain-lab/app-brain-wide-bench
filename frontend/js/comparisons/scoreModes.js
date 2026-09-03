// The panel a task-scores list carries under its rows: a comparison of several scores at once
// — see templates/listView.js for the shape.
//
// There was a second one, a breakdown of whichever single row was selected, shown by default
// with the comparison behind a button. It has gone, and the comparison took its place as the
// default: everything the breakdown said, the comparison says of one score as readily as of
// six, so it was a second reading of the same numbers that had to be kept in step with the
// first — and a button to reach the one panel there is says nothing.

import { createTaskComparison } from "./taskScoreComparison.js";
import { bindTableSelection } from "./comparison.js";

// What the panel needs to start on a row: the rest — the methodology, the per-recording
// breakdown — it fetches for itself.
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

// `base` and no `active`, which is what puts the panel there from the start with no button to
// press first — the same as the leaderboard's comparison and the one under a model's
// submissions. A row is a pick from the moment the list opens, and the panel's own prompt is
// what says so.
const SCORE_MODES = {
  base: {
    title: "Compare task scores",
    create: (container) =>
      createTaskComparison({ container, toEntry: toScoreEntry, methodology: false }),

    // `claimLinks: false`: the model and submission a score belongs to still link to their own
    // pages, and a click anywhere else on the row is a pick. The rows are always picking now,
    // so they cannot also be the thing that swallows the links they carry.
    bindTable: (controller) =>
      bindTableSelection(controller, { claimLinks: false }),
  },
};

export { SCORE_MODES };
