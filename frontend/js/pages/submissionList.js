// The submissions list, in the two scopes the pages ask for:
//
//   data-scope="mine"  submission_list.html         —  the viewer's own teams', signed in
//   data-scope="all"   submission_list_public.html  —  every one they may see, signed out

import { getMySubmissions, getSubmissions } from "../api/submissionApi.js";
import {
  getSubmissionFilters,
  toSubmissionRows,
} from "../utils/submissionUtils.js";
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

  createCards: () => createSubmissionCardGrid(),

  createTable: ({ rows }) =>
    createSubmissionsTable({
      rows,
      showModel: true,
      showFilters: false,
    }),

  createLink: "/html/submissions/submission_create.html",
  filterControls: getSubmissionFilters,
});
