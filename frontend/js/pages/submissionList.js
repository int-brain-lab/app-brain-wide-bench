// The submissions list: submission_list.html, the viewer's own teams', signed in.
//
// No public counterpart, unlike the models and teams lists — every submission a reader may
// see is reachable through the model it was made for, and through the task scores list.

import { getMySubmissions } from "../api/submissionApi.js";
import {
  getSubmissionFilters,
  toSubmissionRows,
} from "../utils/submissionUtils.js";
import { createSubmissionsTable } from "../tables/submissionTable.js";
import { createSubmissionCardGrid } from "../cards/submissionCards.js";
import { MAX_SUBMISSIONS } from "../comparisons/submissionComparison.js";
import { SERIES_COLOURS } from "../plots/palette.js";
import { loadListPage } from "../templates/listPage.js";

// Where Compare goes, and under what name. `with` is the compare page's own parameter for the
// submissions a comparison holds — see pages/submissionCompare.js.
const COMPARE_PAGE = "/html/submissions/compare.html";
const WITH_PARAM = "with";

loadListPage({
  noun: "submission",
  title: "My submissions",

  getRecords: getMySubmissions,
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
    toPick: (row) => ({ key: row.id }),

    onCompare: (ids) => {
      location.href = `${COMPARE_PAGE}?${WITH_PARAM}=${encodeURIComponent(ids.join(","))}`;
    },
  },
});
