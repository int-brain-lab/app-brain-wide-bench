// The submissions the user has created or has access to.

import { getSubmissions } from "./submissionApi.js";
import { renderSubmissionsTable } from "./submissionTable.js";
import { buildSubmissionCards } from "../components/cards.js";
import { loadListPage } from "../pages/list-page.js";

loadListPage({
  title: "My submissions",
  noun: "submissions",
  fetch: getSubmissions,
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
