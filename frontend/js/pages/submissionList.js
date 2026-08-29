// The submissions list, in the two scopes the pages ask for:
//
//   data-scope="mine"  submission_list.html         —  the viewer's own teams' submissions, signed in only
//   data-scope="all"   submission_list_public.html  —  every submission they may see, signed out too

import { toSubmissionRows } from "../utils/submissionUtils.js";
import { getSubmissions, getMySubmissions } from "../api/submissionApi.js";
import { getSubmissionFilters } from "../utils/submissionUtils.js";
import { createSubmissionsTable } from "../tables/submissionTable.js";
import { createSubmissionCardGrid } from "../cards/submissionCards.js";
import { loadListPage } from "../templates/listPage.js";

const MINE = document.body.dataset.scope === "mine";

loadListPage({
  noun: "submission",
  title: MINE ? "My submissions" : "Submissions",
  requiresAuth: MINE,

  getRecords: MINE ? getMySubmissions : getSubmissions,
  recordsToRows: toSubmissionRows,

  createCards: () =>
    createSubmissionCardGrid({
      showMine: !MINE,
      cardsPerPage: 8,
    }),

  createTable: ({ rows }) =>
    createSubmissionsTable({
      rows,
      showModel: true,
      showFilters: false,
    }),

  filterControls: getSubmissionFilters,
  createLink: "/html/submissions/submission_create.html",
});
