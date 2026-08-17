// The submissions the user has created or has access to.

import { getMySubmissions } from "../api/submissionApi.js";
import { renderSubmissionsTable } from "../tables/submissionTable.js";
import { buildSubmissionCards } from "../cards/submissionCards.js";
import { loadListPage } from "../templates/list-page.js";

loadListPage({
  title: "My submissions",
  noun: "submissions",
  fetch: getMySubmissions,
  cards: buildSubmissionCards,
  // Spans models, so the Model column earns its place here where it doesn't on a model's
  // own submissions table.
  table: ({ container, rows }) =>
    renderSubmissionsTable({ container, submissions: rows, showModel: true }),
  create: {
    href: "/html/submissions/submission_create.html",
    label: "New submission",
  },
});
