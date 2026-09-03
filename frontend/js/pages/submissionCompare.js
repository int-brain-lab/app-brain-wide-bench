// Compare page — a handful of submissions read against each other.
//
// One way in: /compare.html?with=<ids>, from the submissions list, which picked them. There is
// no reference submission the page is about, so nothing here chooses what is compared: the
// table is those submissions and only those, every one of them picked.
//
// Which is why it is a shorter page than the models' own. That one has a second entrance from
// a model's page — a reference the page is titled after, a suite chosen for it, and every
// other model on that suite offered alongside — and all of the choosing that follows from it.
// Here the choosing already happened in the list.
//
// The comparison itself is not this page's: it is the widget the leaderboard and the models
// list also mount, in its submissions preset — see comparisons/submissionComparison.js. So
// this page is only what leads to it:
//
//   models       the submissions compared, as a table. Unticking a row takes it out
//   comparison   the widget, which fetches what each submission needs itself
//
// No filter bar over the table and no suite select above it: six rows the reader chose have
// nothing left to narrow, and which suite the scores are read on is the widget's own control,
// inside the panel the scores are in.

import { renderHtml } from "../core/render.js";
import { buildEmptyMessage } from "../components/messages.js";
import { dispose } from "../core/disposable.js";
import { getSubmissions } from "../api/submissionApi.js";
import { toSubmissionRows } from "../utils/submissionUtils.js";
import { loadPage } from "../templates/page.js";
import { createSubmissionsTable } from "../tables/submissionTable.js";
import {
  MAX_SUBMISSIONS,
  createSubmissionComparison,
} from "../comparisons/submissionComparison.js";
import { bindTableSelection } from "../comparisons/comparison.js";
import { renderHeader, renderPage } from "../templates/pageChrome.js";
import {
  buildHeader,
  buildPage,
  buildSection,
  buildSections,
  getSection,
  getSectionBody,
} from "../components/sections.js";

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

const SUBMISSION_LIST_PAGE = "/html/submissions/submission_list_public.html";

const BACK_TEXT = "← Back to submissions";

const TITLE = "Compare submissions";

// `with` rather than `submissions`: it reads as the sentence the URL is making, and the same
// parameter the models' compare page uses for the same job.
const WITH_PARAM = "with";

// The table and the comparison under it, so they can be hidden together while there is
// nothing to put in them.
const RESULT_SECTIONS = ["submissions", "comparison"];

// ─── URL STATE ───────────────────────────────────────────────────────────────

// Nothing is validated here: a submission named in `with` may have been deleted, or made
// private, since the URL was written. Which of them survive is settled once the list is in
// hand — see pruneSelection.
function readSelection() {
  const params = new URLSearchParams(location.search);

  return {
    withIds: (params.get(WITH_PARAM) ?? "").split(",").filter(Boolean),
  };
}

// replaceState, not pushState: a comparison is built by working a table, and each change would
// otherwise be a history entry the reader has to press Back through to leave the page. The URL
// still survives a refresh and can still be sent to someone.
function writeSelection({ withIds }) {
  const params = new URLSearchParams(location.search);

  if (withIds.length) params.set(WITH_PARAM, withIds.join(","));
  else params.delete(WITH_PARAM);

  history.replaceState(history.state, "", `?${params}`);
}

// ─── PAGE ────────────────────────────────────────────────────────────────────

function renderComparePage({ submissions }) {
  renderPage(
    buildPage({
      back: { text: BACK_TEXT, href: SUBMISSION_LIST_PAGE },
      header: buildHeader(),

      body:
        // Untitled: it holds whatever is standing in for the page — a URL whose submissions
        // have all gone — and a heading over that would be a heading over an apology.
        buildSection({ id: "intro" }) +
        buildSections([
          { id: "submissions", title: "Submissions compared" },
          { id: "comparison", title: "Comparison" },
        ]),
    }),
  );

  renderHeader(TITLE, [], []);

  const state = readSelection();

  let table = null;

  // The whole of the reading: the details grid, the task breakdown and the differences, in
  // whichever view the reader last chose. It holds what is picked; the table above is bound to
  // it, so unticking a row there takes it out of the comparison.
  //
  // No suite passed to `set` below, so the widget's own suite select is the one in force — see
  // getSuite in comparisons/recordComparison.js, where a host's suite would override it.
  const comparison = createSubmissionComparison({
    container: getSectionBody("comparison"),
  });

  const picking = bindTableSelection(comparison);

  function showSections(ids, shown) {
    for (const id of ids) {
      const section = getSection(id);

      if (section) section.hidden = !shown;
    }
  }

  // The submissions the URL names, as records: the ones that still exist and this reader may
  // see, which is whatever the list returned.
  function offered() {
    const wanted = new Set(state.withIds);

    return submissions.filter((candidate) => wanted.has(candidate.id));
  }

  // Narrows the ids in the URL to those, in the order they were asked for, and no more than
  // the comparison holds.
  function pruneSelection(withIds) {
    const allowed = new Set(offered().map((candidate) => candidate.id));

    return withIds.filter((id) => allowed.has(id)).slice(0, MAX_SUBMISSIONS);
  }

  // ─── SECTIONS ──────────────────────────────────────────────────────────────

  // In the order the URL names them, not the order Tabulator reports: the colours a comparison
  // hands out go by the order picks arrive, and the list that sent the reader here marked its
  // rows in that same order — so a submission keeps the colour it was picked in.
  function inChosenOrder(rows) {
    const rank = new Map(state.withIds.map((id, at) => [id, at]));

    return [...rows].sort(
      (a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity),
    );
  }

  function onSelection(rows) {
    comparison.set(inChosenOrder(rows));

    // The comparison refuses a pick past its cap, so the table may be showing a highlight it
    // doesn't hold; this takes it back.
    picking.sync();

    // Written from what the comparison holds rather than from what the table reported, so a
    // refused pick never reaches the URL.
    state.withIds = comparison.keys();

    writeSelection(state);
  }

  // What is being compared, and what says so: one row per submission the reader picked, all of
  // them highlighted. Unticking one is how a reader narrows what they brought.
  function renderSubmissions() {
    dispose(table);
    comparison.clear();

    const { element, table: instance } = createSubmissionsTable({
      rows: toSubmissionRows(offered()),
      // The reader is comparing across models, which is what makes the model's own name worth
      // a column here.
      showModel: true,
      // Already the submissions the reader chose, in a table of a handful of rows: there is
      // nothing left to narrow, and a bar of empty controls over six rows reads as a list that
      // failed to load the rest of itself.
      showFilters: false,
      selection: {
        max: MAX_SUBMISSIONS,
        onChange: onSelection,
        // The row is the control while picking, so a click on the label picks it rather than
        // leaving the page and this comparison with it.
        claimLinks: true,
      },
    });

    table = instance;
    getSectionBody("submissions").replaceChildren(element);

    // After the build rather than straight away: Tabulator constructs its rows
    // asynchronously, and a selectRow before that has nothing to select. Selecting is what
    // fills the comparison, through the same handler a reader's click goes through.
    table.on("tableBuilt", () => {
      table.selectRow([...state.withIds]);
    });

    picking.attach(table);
  }

  // ─── START ─────────────────────────────────────────────────────────────────

  // Nothing to compare: every submission the URL named has gone, or it named none. The results
  // have nothing to say, so they are hidden rather than left standing empty under their titles.
  function renderIntro(message) {
    dispose(table);
    table = null;
    comparison.clear();

    showSections(RESULT_SECTIONS, false);
    showSections(["intro"], true);

    renderHtml(getSectionBody("intro"), buildEmptyMessage(message));
  }

  function start() {
    state.withIds = pruneSelection(state.withIds);

    writeSelection(state);

    if (!state.withIds.length) {
      renderIntro(
        "No submissions to compare. Pick some in the submissions list and press Compare.",
      );

      return;
    }

    showSections(["intro"], false);
    showSections(RESULT_SECTIONS, true);

    renderSubmissions();
  }

  return start();
}

// ─── LOAD ────────────────────────────────────────────────────────────────────

loadPage({
  noun: "submission",

  // The page is about a set named in the URL rather than one record, so there is no id for
  // loadPage to find or to refuse the page for want of.
  requiresId: false,

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

  render: renderComparePage,
});
