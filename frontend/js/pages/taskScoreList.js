// Every task score the viewer may see: the dashboard's scores view, unscoped.
//
// The rows, the columns, the filter bar and the comparison panel are the dashboard's own —
// utils/taskScoreUtils.js, tables/taskScoreTable.js and comparisons/scoreModes.js — so the two
// pages differ only in which task submissions they are handed.

import { getTaskSubmissions } from "../api/taskSubmissionApi.js";
import { loadTaskFields } from "../schemas/taskSubmissionSchema.js";
import {
  getTaskScoreFilters,
  toScoreResultRows,
} from "../utils/taskScoreUtils.js";
import { createTaskScoresTable } from "../tables/taskScoreTable.js";
import { SCORE_MODES } from "../comparisons/scoreModes.js";
import { loadListPage } from "../templates/listPage.js";

// The rows span every model and submission, so both columns are named rather than assumed.
const DISPLAY = { showModel: true, showSubmission: true };

loadListPage({
  noun: "score",
  title: "Task scores",
  description: "Every scored task on a submission the viewer may see.",

  // The public counterpart of the dashboard's view: signed out it is the public submissions'
  // tasks, and a session adds the reader's own teams'.
  requiresAuth: false,

  // `loadTaskFields` costs no second request and fills the methodology fields' options in
  // place from the server's own enums, which is where the filters read them from. Caught
  // rather than allowed to reject: a failing /api/meta then costs those filters their options
  // rather than the page its list.
  getRecords: async () => {
    const [records] = await Promise.all([
      getTaskSubmissions(),
      loadTaskFields().catch(() => undefined),
    ]);

    return records;
  },

  recordsToRows: toScoreResultRows,

  // No cards: a score is a row of numbers, and there is no card that reads them.
  createTable: ({ rows, selection }) =>
    createTaskScoresTable({
      ...DISPLAY,
      rows,
      selection,
      showFilters: false,
    }),

  filterControls: (rows) => getTaskScoreFilters(rows, DISPLAY),

  modes: SCORE_MODES,
});
