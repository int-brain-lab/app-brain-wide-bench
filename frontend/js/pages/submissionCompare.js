// Compare page — a handful of submissions read against each other.
//
// One way in: /compare.html?with=<ids>, from the submissions list, which picked them. There is
// no submission the page is about, so it opens on exactly those.
//
// The page itself is templates/comparePage.js: the shell, the URL, the select that puts one
// more in. This module is only what makes it a comparison of *submissions* — what it loads,
// what its header says, and where a reader goes back to.
//
// No suite select above it: which suite the scores are read on is the widget's own control,
// inside the panel the scores are in.

import { getSubmissions } from "../api/submissionApi.js";
import { toSubmissionRows } from "../utils/submissionUtils.js";
import {
  createSubmissionComparison,
} from "../comparisons/submissionComparison.js";
import { loadComparePage } from "../templates/comparePage.js";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

const SUBMISSION_LIST_PAGE = "/html/submissions/submission_list.html";

const BACK_TEXT = "← Back to submissions";

// What the page is called: a set of submissions has no one of them to be titled after.
const TITLE = "Compare submissions";

// ─── LABELS ──────────────────────────────────────────────────────────────────

// Submission labels repeat across models.
function labelOf(row) {
  return row.model_name ? `${row.label} — ${row.model_name}` : row.label;
}

// ─── LOAD ────────────────────────────────────────────────────────────────────

loadComparePage({
  noun: "submission",

  // A public submission is readable by anyone — see GET /api/submissions — so one URL serves
  // signed-out and signed-in readers alike.
  requiresAuth: false,

  // The list rather than each submission by id: it is one request instead of six, and it is
  // also what says which of the ids the URL names this reader may actually see. What each
  // submission's scores are comes later, per pick, from the comparison's own fetch.
  load: async () => {
    const submissions = await getSubmissions();

    return { submissions: submissions ?? [] };
  },

  toRows: ({ submissions }) => toSubmissionRows(submissions),
  createComparison: createSubmissionComparison,

  back: () => ({ text: BACK_TEXT, href: SUBMISSION_LIST_PAGE }),
  header: () => ({ title: TITLE }),

  optionLabel: labelOf,
});
