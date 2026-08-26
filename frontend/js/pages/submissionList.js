// The submissions list, in the two scopes the pages ask for:
//
//   data-scope="mine"  submission_list.html    — the viewer's own, signed in only
//   data-scope="all"   submission_list_public.html  — every submission they may see, public
//
// One script, as modelList.js — the two differ only in the fetch and the heading.

import { getSubmissions, getMySubmissions } from "../api/submissionApi.js";
import {
  getSubmissionControls,
  renderSubmissionsTable,
  toSubmissionRows,
} from "../tables/submissionTable.js";
import { buildSubmissionCards } from "../cards/submissionCards.js";
import { loadListPage } from "../templates/list-page.js";

const MINE = document.body.dataset.scope === "mine";

loadListPage({
  title: MINE ? "My submissions" : "Submissions",
  noun: "submissions",
  fetch: MINE ? getMySubmissions : getSubmissions,
  requiresAuth: MINE,
  toRows: toSubmissionRows,
  // The table's own controls, hoisted to the page: one bar over both views, and the cards
  // render from the rows it matches against.
  filters: getSubmissionControls,
  cards: buildSubmissionCards,
  // Spans models, so the Model column earns its place here where it doesn't on a model's
  // own submissions table.
  table: ({ container, rows }) =>
    renderSubmissionsTable({ container, rows, showModel: true, showFilters: false }),
  create: {
    href: "/html/submissions/submission_create.html",
    label: "New submission",
  },
});
