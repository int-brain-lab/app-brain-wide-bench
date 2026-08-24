// Page entry for html/leaderboard/leaderboard.html.
//
// Thin, like modelList.js and submissionList.js: fetch, then hand the payload to the table
// module. The rows, columns, controls and the grouping/metric behaviour are all in
// leaderboardTable.js; the fetch is in leaderboardApi.js.
//
// What this page owns beyond that is the field filter. It sits above the table rather than
// inside it because it is a different kind of narrowing: the table's own model search hides
// rows and leaves every rank alone, while this one changes who a model is ranked against
// and so has to go back to the server for new ranks.
//
// The chrome is the shared one — header, body section, message region — so the leaderboard
// reports an empty result or a failure exactly as the list pages do.

import { getLeaderboard } from "../api/leaderboardApi.js";
import { getTasks } from "../api/taskApi.js";
import { isAuthenticated } from "../api/client.js";
import { renderLeaderboardTable } from "../tables/leaderboardTable.js";
import { applyShell } from "../templates/shell.js";
import { escapeHtml, showEmpty, showFailure, showMessage } from "../core/utils.js";
import {
  buildBody,
  buildHeader,
  buildPage,
  buildSection,
  renderHeader,
  renderPage,
  sectionBody,
  showPageError,
} from "../templates/record-page.js";


// ─── CONSTANTS ──────────────────────────────────────────────────────────────

const TITLE = "Leaderboard";
const DESCRIPTION = "Public, completed submissions scored against held-out test data.";

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

  return { isPretrained: PRETRAINED_OPTIONS.some(o => o.value === value) ? value : "" };
}

// replaceState, not pushState: working a dropdown shouldn't build a stack of history
// entries to press Back through. The URL still survives a refresh and can still be sent.
function writeFilters({ isPretrained }) {
  const params = new URLSearchParams(location.search);

  if (isPretrained) params.set(PRETRAINED_PARAM, isPretrained);
  else params.delete(PRETRAINED_PARAM);

  history.replaceState(history.state, "", params.size ? `?${params}` : location.pathname);
}

function buildFilterBar(selected) {
  const options = PRETRAINED_OPTIONS
    .map(option => `
      <option value="${escapeHtml(option.value)}" ${option.value === selected ? "selected" : ""}>
        ${escapeHtml(option.label)}
      </option>
    `)
    .join("");

  return `
    <div class="row left gap-md">
      <span class="metadata">Restrict the field</span>
      <span class="inline-select">
        <select class="input-select" data-role="pretrained">${options}</select>
      </span>
    </div>
  `;
}


// ─── INITIALISATION ─────────────────────────────────────────────────────────

async function loadLeaderboardPage() {
  try {
    // Before anything renders, so the page settles into one shell rather than rearranging
    // itself around the table once the rows land.
    applyShell(await isAuthenticated());

    renderPage(
      buildPage({
        header: buildHeader(),
        body: buildSection({ id: "filters" }) + buildBody(),
      }),
    );

    renderHeader(TITLE, DESCRIPTION);

    const filters = readFilters();

    // Fetched once and kept: the task table is what the columns are built from, and it does
    // not change with the filter — only the rows do.
    const tasks = await getTasks();

    if (!tasks) {
      showFailure(sectionBody("body"), "Loading the leaderboard failed.");
      return;
    }

    // Replacing the section's contents detaches a Tabulator's element but doesn't free it;
    // its own registry keeps the instance and its ResizeObserver alive, one orphan per
    // filter change.
    let table = null;

    // A reader can change the filter faster than the fetch returns, and without this the
    // slower answer lands last and draws a board nobody asked for.
    let latest = 0;

    async function renderBoard() {
      const token = ++latest;

      table?.destroy?.();
      table = null;

      showMessage(sectionBody("body"), "Loading scores…");

      const submissions = await getLeaderboard(filters);

      if (token !== latest) return;

      if (!submissions) {
        showFailure(sectionBody("body"), "Loading the leaderboard failed.");
        return;
      }

      // An empty payload isn't a failure, but why it is empty differs: nothing scored yet is
      // a fact about the benchmark, and nothing matching is a fact about the filter. Saying
      // the wrong one sends the reader looking in the wrong place.
      if (submissions.length === 0) {
        showEmpty(
          sectionBody("body"),
          filters.isPretrained
            ? "No models match this filter yet — most submissions haven't recorded whether their model is pretrained."
            : "No public submissions have been scored yet.",
        );
        return;
      }

      table = renderLeaderboardTable({ container: sectionBody("body"), submissions, tasks });
    }

    sectionBody("filters").innerHTML = buildFilterBar(filters.isPretrained);

    sectionBody("filters")
      .querySelector("[data-role='pretrained']")
      .addEventListener("change", event => {
        filters.isPretrained = event.target.value;
        writeFilters(filters);
        renderBoard();
      });

    await renderBoard();
  } catch (error) {
    console.error("Failed to initialise the leaderboard:", error);

    showPageError("The leaderboard page could not be loaded.", error);
  }
}

loadLeaderboardPage();
