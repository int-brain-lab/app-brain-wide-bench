// Page entry for html/leaderboard/leaderboard.html.
//
// Thin, like modelList.js and submissionList.js: fetch, then hand the payload to the table
// module. The rows, columns, controls and the grouping/metric behaviour are all in
// leaderboardTable.js; the fetch is in leaderboardApi.js.
//
// It also owns the reader's own team ids. /api/leaderboard has no notion of a caller — that
// is what keeps one public board cacheable — so marking which rows are the reader's is an
// intersection done here, from a second request for their memberships.
//
// What this page owns beyond that is the field filter. It sits above the table rather than
// inside it because it is a different kind of narrowing: the table's own model search hides
// rows and leaves every rank alone, while this one changes who a model is ranked against
// and so has to go back to the server for new ranks.
//
// The chrome is the shared one — header, body section, message region — so the leaderboard
// reports an empty result or a failure exactly as the list pages do. It boots through
// loadPage for the same reason: resolving the session, choosing the shell and reporting a
// failure are the same job on every page, and this one was doing its own version of it.

import { getLeaderboard } from "../api/leaderboardApi.js";
import { getTasks } from "../api/taskApi.js";
import { getMyTeams } from "../api/teamApi.js";
import { renderLeaderboardTable } from "../tables/leaderboardTable.js";
import {
  MAX_COMPARED,
  createTaskComparison,
} from "../widgets/taskComparison.js";
import { createTaskBreakdown } from "../widgets/taskBreakdown.js";
import { createModelComparison } from "../widgets/modelComparison.js";
import { loadPage } from "../templates/page-loader.js";
import {
  escapeHtml,
  refreshIcons,
  showEmpty,
  showFailure,
  showMessage,
} from "../core/utils.js";
import { dispose } from "../core/disposable.js";
import { getIcon } from "../components/icons.js";
import {
  buildBody,
  buildHeader,
  buildPage,
  buildSection,
  renderHeader,
  renderPage,
  sectionBody,
} from "../templates/record-page.js";

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

const TITLE = "Leaderboard";
const DESCRIPTION =
  "Public, completed submissions scored against held-out test data.";

const PRETRAINED_PARAM = "pretrained";

// Hardcoded rather than derived from the rows, the same way SUITE_OPTIONS is: an option
// that disappeared exactly when nothing on the board matched it would be the one worth
// offering. "" first so it is what the select opens on.
//
// Only the two answers, so a model whose flag was never filled in is in "All models" and
// nowhere else — the endpoint treats an unanswered question as neither value.
const PRETRAINED_OPTIONS = [
  { value: "", label: "All models" },
  { value: "true", label: "Pretrained" },
  { value: "false", label: "Not pretrained" },
];

// ─── FILTER ─────────────────────────────────────────────────────────────────

function readFilters() {
  const value = new URLSearchParams(location.search).get(PRETRAINED_PARAM);

  return {
    isPretrained: PRETRAINED_OPTIONS.some((o) => o.value === value)
      ? value
      : "",
  };
}

// replaceState, not pushState: working a dropdown shouldn't build a stack of history
// entries to press Back through. The URL still survives a refresh and can still be sent.
function writeFilters({ isPretrained }) {
  const params = new URLSearchParams(location.search);

  if (isPretrained) params.set(PRETRAINED_PARAM, isPretrained);
  else params.delete(PRETRAINED_PARAM);

  history.replaceState(
    history.state,
    "",
    params.size ? `?${params}` : location.pathname,
  );
}

function buildFilterBar(selected, comparing) {
  const options = PRETRAINED_OPTIONS.map(
    (option) => `
      <option value="${escapeHtml(option.value)}" ${option.value === selected ? "selected" : ""}>
        ${escapeHtml(option.label)}
      </option>
    `,
  ).join("");

  // The filter on the left, the mode on the right: one narrows the board, the other changes
  // what a click on a row does, and they are different kinds of control.
  return `
    <div class="row">
      <span class="row left gap-md">
        <span class="metadata">Restrict the field</span>
        <span class="inline-select">
          <select class="input-select" data-role="pretrained">${options}</select>
        </span>
      </span>
      <button type="button" class="btn with-icon ${comparing ? "primary-inv" : ""}" data-role="mode">
        <i class="btn-icon" data-lucide="${escapeHtml(getIcon("compare"))}"></i>
        ${comparing ? "Done comparing" : "Compare tasks"}
      </button>
    </div>
  `;
}

// ─── INITIALISATION ─────────────────────────────────────────────────────────

function renderLeaderboardPage({ tasks, myTeamIds }) {
  renderPage(
    buildPage({
      header: buildHeader(),
      body:
        buildSection({ id: "filters" }) +
        buildBody() +
        buildSection({ id: "compare", title: "Compare on this task" }),
    }),
  );

  renderHeader(TITLE, DESCRIPTION);

  const filters = readFilters();

  // Replacing the section's contents detaches a Tabulator's element but doesn't free it;
  // its own registry keeps the instance and its ResizeObserver alive, one orphan per
  // filter change.
  let table = null;

  // Built once for the page rather than per render: it holds the reader's choice of view
  // and whatever it has already fetched, and the board underneath it is rebuilt on every
  // filter change.
  //
  // Hidden until there is something in it — the section heading claims a comparison, and
  // an empty one under a board nobody has selected from is a promise the page hasn't kept.
  const compareSection = sectionBody("compare").closest(".page-section");

  // The section holds one of two things, so it says which — a heading promising a
  // comparison over a single score's breakdown would be describing the wrong thing.
  function showCompareSection(visible, title = "Compare on this task") {
    compareSection.hidden = !visible;
    compareSection.querySelector(".section-title").textContent = title;
  }

  // A pane per comparison rather than one shared element. Each widget delegates clicks from
  // its own root, so a shared root means every widget hears every other one's ✕ — and one
  // handed a key from a widget it isn't listening to looks up nothing, which is how a single
  // removal used to clear the whole board.
  const PANES = ["tasks", "browse", "models"];

  // Two elements per pane, because a widget's empty state un-hides the element it draws
  // into — see renderMessage. The one the page hides therefore can't be one a widget owns.
  sectionBody("compare").innerHTML = PANES.map(
    (name) => `<div data-pane="${name}" hidden><div></div></div>`,
  ).join("");

  function pane(name) {
    return sectionBody("compare").querySelector(`[data-pane='${name}']`);
  }

  function paneBody(name) {
    return pane(name).firstElementChild;
  }

  // Only one is ever open, and the other two keep whatever they last drew: a reader who
  // unticks everything and ticks again finds the comparison as they left it.
  function showPane(name) {
    for (const key of PANES) pane(key).hidden = key !== name;
  }

  // What a fresh compare mode invites, which depends on what the board is showing: one
  // task makes the rows scores to compare against each other, anything coarser makes them
  // models to compare across a suite.
  // Both branches say it through the widget's own empty state rather than writing one over
  // the top of it: the cap and the wording are the comparison's, and the page only decides
  // which of the two is being invited.
  function promptToCompare(metric) {
    if (!taskFor(metric)) {
      showCompareSection(true, "Compare models");
      showPane("models");
      models.clear();

      return;
    }

    showCompareSection(true);
    showPane("tasks");
    comparison.clear();
  }

  // A comparison knows a score by the entry that produced it; the board knows a row by
  // the standing it belongs to. This is the map between them, so a ✕ in the comparison
  // can untick the right row.
  const rowOf = new Map();

  const comparison = createTaskComparison({
    container: paneBody("tasks"),
    // A board row is a model's standing on the chosen task, so "rows" rather than the
    // "task scores" the scores page calls the same things.
    prompt: `Select up to ${MAX_COMPARED} rows to compare their scores on this task.`,
    // Guarded: Tabulator reads a missing index as "no argument" and deselects every row, so
    // a key this map has not seen would untick the board rather than one row.
    onDrop: (key) => rowOf.has(key) && table?.deselectRow(rowOf.get(key)),
  });

  // One per pane: comparing is a mode, the two comparisons are what the metric select
  // decides between, and browsing is what a row click does outside compare mode altogether.
  const breakdown = createTaskBreakdown({ container: paneBody("browse") });

  const models = createModelComparison({
    container: paneBody("models"),
    onDrop: (key) => table?.deselectRow(key),
  });

  // Which row is open, marked on the row itself: outside compare mode nothing is selected,
  // so there is no highlight of Tabulator's to borrow.
  let openRow = null;

  function markOpen(element) {
    openRow?.classList.remove("row-open");
    openRow = element ?? null;
    openRow?.classList.add("row-open");
  }

  showCompareSection(false);

  // A leaderboard row is a model's standing, so its score on the chosen task names the
  // entry that produced it — see LeaderboardScore. That is all a comparison needs to
  // start; it fetches the breakdown and the methodology itself.
  function toSeed(row, taskId) {
    const score = row.scores?.[taskId];

    return (
      score && {
        key: score.task_submission_id,
        taskId,
        submissionId: score.submission_id,
        modelName: row.title,
        metric: score.metric,
      }
    );
  }

  // Which of the two comparisons a tick is for. The metric select decides: a task makes a
  // row one score, and anything coarser — a suite, or Overall — makes it a whole model.
  function taskFor(metric) {
    return tasks.some((task) => task.id === metric) ? metric : null;
  }

  // A board row names a model and carries none of its specification, which is what the
  // comparison fetches for itself. The row's own id is its standing's newest submission —
  // the only handle the table has — so that is the key a ✕ hands back.
  function toModelSeed(row) {
    return {
      key: row.submissionId,
      modelId: row.modelId,
      name: row.title,
      teamName: row.affiliation,
    };
  }

  // A model's name is a link to its page, and a click that landed on it is going there —
  // opening a breakdown underneath as well would be two answers to one click.
  function onRowClick(row, metric, { event, element }) {
    if (event.target.closest("a")) return;

    const seed = toSeed(row, metric);

    // Nothing to open: the board is showing a suite or the overall figure, where a row is
    // several scores rather than one.
    if (!seed) return;

    markOpen(element);
    showCompareSection(true, "Task detail");
    showPane("browse");
    breakdown.show(seed);
  }

  async function onSelection(rows, metric) {
    const taskId = taskFor(metric);

    // No task means the rows are models rather than scores, and the comparison for that is
    // a different one — the specification of each, and how they scored across the suite.
    if (!taskId) {
      comparison.clear();
      showCompareSection(true, "Compare models");
      showPane("models");

      const overflow = await models.show(rows.map(toModelSeed), metric);

      for (const key of overflow) table?.deselectRow(key);

      return;
    }

    models.clear();

    rowOf.clear();

    const seeds = [];

    for (const row of rows) {
      const seed = toSeed(row, taskId);

      if (!seed) continue;

      rowOf.set(seed.key, row.submissionId);
      seeds.push(seed);
    }

    // Nothing ticked yet: the section stays and says what to do, since the reader asked
    // for it by pressing the button.
    if (!seeds.length) {
      promptToCompare(metric);

      return;
    }

    // Re-stated rather than assumed: the heading may still be the model comparison's, from
    // a compare mode that opened on a suite before the reader picked a task.
    showCompareSection(true);
    showPane("tasks");

    const overflow = await comparison.show(seeds);

    // Tabulator caps selection by click but refuses the extra one silently; putting it
    // back is what keeps the ticks and the comparison saying the same thing.
    for (const key of overflow) table?.deselectRow(rowOf.get(key));
  }

  // Whether rows are pickable, and the payload they are picked from. The mode is a
  // property of the page rather than of a fetch: switching it re-mounts the board from
  // what is already in hand, since the rows haven't changed — only what a click does.
  let comparing = false;
  let standings = null;

  // The metric select belongs to the table's filter bar, so the page reads it back rather
  // than keeping a second copy that could disagree with the control on screen.
  function currentMetric() {
    return (
      sectionBody("body").querySelector("[data-filter='metric']")?.value ?? ""
    );
  }

  function mountTable() {
    dispose(table);

    // A new mode or a new board closes whatever was open.
    comparison.clear();
    models.clear();
    breakdown.clear();
    markOpen(null);

    if (comparing) promptToCompare(currentMetric());
    else showCompareSection(false);

    table = renderLeaderboardTable({
      container: sectionBody("body"),
      standings,
      tasks,
      myTeamIds,
      // One or the other, never both: in compare mode a row click picks the row for the
      // comparison, and the rest of the time it opens the row's breakdown underneath. Both
      // bound at once would be two answers to one click.
      ...(comparing
        ? {
            selection: {
              max: MAX_COMPARED,
              onChange: onSelection,
              claimLinks: true,
            },
          }
        : { onRowClick }),
    });
  }

  function setMode(next) {
    comparing = next;

    sectionBody("filters").innerHTML = buildFilterBar(
      filters.isPretrained,
      comparing,
    );
    refreshIcons();

    if (standings?.length) mountTable();
    else showCompareSection(false);
  }

  // A reader can change the filter faster than the fetch returns, and without this the
  // slower answer lands last and draws a board nobody asked for.
  let latest = 0;

  async function renderBoard() {
    const token = ++latest;

    dispose(table);
    table = null;

    showMessage(sectionBody("body"), "Loading scores…");

    standings = await getLeaderboard(filters);

    if (token !== latest) return;

    if (!standings) {
      showFailure(sectionBody("body"), "Loading the leaderboard failed.");
      return;
    }

    // An empty payload isn't a failure, but why it is empty differs: nothing scored yet is
    // a fact about the benchmark, and nothing matching is a fact about the filter. Saying
    // the wrong one sends the reader looking in the wrong place.
    if (standings.length === 0) {
      showEmpty(
        sectionBody("body"),
        filters.isPretrained
          ? "No models match this filter yet — most submissions haven't recorded whether their model is pretrained."
          : "No public submissions have been scored yet.",
      );
      return;
    }

    mountTable();
  }

  setMode(false);

  // Delegated, because the bar is rewritten whenever the mode changes and the button in
  // it is what changes.
  sectionBody("filters").addEventListener("input", (event) => {
    const pretrained = event.target.closest("[data-role='pretrained']");

    if (!pretrained) return;

    filters.isPretrained = pretrained.value;
    writeFilters(filters);
    renderBoard();
  });

  sectionBody("filters").addEventListener("click", (event) => {
    if (event.target.closest("[data-role='mode']")) setMode(!comparing);
  });

  return renderBoard();
}

loadPage({
  noun: "leaderboard",

  // Neither: the board is one URL for everyone, and it is about no particular record.
  requiresId: false,
  requiresAuth: false,

  load: async (id, { signedIn }) => {
    // Fetched once and kept: the task table is what the columns are built from, and it does
    // not change with the filter — only the rows do. A failure here is the page failing,
    // which is loadPage's to report.
    //
    // The memberships are fetched once too, and only when there is a session to fetch them
    // for. A failure there leaves the set empty, so the board renders without the "Yours"
    // pill rather than not at all — knowing which rows are yours is the least of what this
    // page is for.
    const [tasks, teams] = await Promise.all([
      getTasks(),
      signedIn ? getMyTeams() : [],
    ]);

    return (
      tasks && {
        tasks,
        myTeamIds: new Set((teams ?? []).map((team) => String(team.id))),
      }
    );
  },

  render: renderLeaderboardPage,
});
