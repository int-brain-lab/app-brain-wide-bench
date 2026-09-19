// Every task score the viewer may see: the dashboard's scores view, unscoped.
//
// The rows, the columns, the filter bar and the comparison panel are the dashboard's own —
// utils/taskScoreUtils.js, tables/taskScoreTable.js and comparisons/taskScoreComparison.js
// — so the two pages differ only in which task submissions they are handed.

import { getTaskSubmissions } from "../api/taskSubmissionApi.js";
import { loadTaskFields } from "../schemas/taskSubmissionSchema.js";
import { getTaskScoreFilters, toScoreResultRows } from "../utils/taskScoreUtils.js";
import { createTaskScoresTable } from "../tables/taskScoreTable.js";
import { createTaskScoreCardGrid } from "../cards/taskCards.js";
import { SCORE_PANEL } from "../comparisons/taskScoreComparison.js";
import { loadListPage } from "../templates/listPage.js";

// The rows span every model and submission, so both columns are named rather than assumed.
const DISPLAY = { showModel: true, showSubmission: true };

loadListPage({
  noun: "score",
  title: "Task scores",

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

  // The task, the score as a number and a bar, and two methodology fields. Also what the page
  // shows below CARDS_QUERY, which has no table view.
  createCards: () => createTaskScoreCardGrid(DISPLAY),

  // Sooner than the shared width: this table carries the five methodology columns as well as
  // the task, the score and the two records it came from.
  cardsQuery: "(max-width: 900px)",

  createTable: ({ rows, selection }) =>
    createTaskScoresTable({
      ...DISPLAY,
      rows,
      selection,
      showFilters: false,
    }),

  filterControls: (rows) => getTaskScoreFilters(rows, DISPLAY),

  panel: SCORE_PANEL,
});
