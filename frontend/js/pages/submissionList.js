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
import { MAX_SUBMISSIONS } from "../comparisons/submissionComparison.js";
import { SERIES_COLOURS } from "../plots/palette.js";
import { loadListPage } from "../templates/listPage.js";

const MINE = document.body.dataset.scope === "mine";

// Where Compare goes, and under what name. `with` is the compare page's own parameter for the
// submissions a comparison holds — see pages/submissionCompare.js.
const COMPARE_PAGE = "/html/submissions/compare.html";
const WITH_PARAM = "with";

loadListPage({
  noun: "submission",
  title: MINE ? "My submissions" : "Submissions",
  requiresAuth: MINE,

  getRecords: MINE ? getMySubmissions : getSubmissions,
  recordsToRows: toSubmissionRows,

  createCards: () => createSubmissionCardGrid(),

  createTable: ({ rows, selection }) =>
    createSubmissionsTable({
      rows,
      showModel: true,
      showFilters: false,
      selection,
    }),

  createLink: "/html/submissions/submission_create.html",
  filterControls: getSubmissionFilters,

  // The same arrangement the models list has: a row highlights rather than opening anything,
  // the submission's own label still goes to its page, and Compare hands the picks to
  // /compare.html. The palette is the comparison's own, so a row is marked here in the colour
  // its submission will be drawn in over there.
  picking: {
    max: MAX_SUBMISSIONS,
    palette: SERIES_COLOURS,
    label: "Compare",

    toEntry: (row) => ({ key: row.id }),

    onCompare: (ids) => {
      location.href = `${COMPARE_PAGE}?${WITH_PARAM}=${encodeURIComponent(ids.join(","))}`;
    },
  },
});
