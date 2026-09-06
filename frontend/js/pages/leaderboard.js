// Page entry for html/leaderboard/leaderboard.html.
//
// The board, the two controls above it — widgets/taskSelection.js and
// widgets/leaderboardFilters.js — and the model comparison under it. Rows and ranking are
// utils/leaderboardUtils.js, columns are tables/leaderboardTable.js.
//
// A task change re-ranks in place; a filter change refetches, since the server ranks over
// whatever survives the filter.
//
// /api/leaderboard has no notion of a caller, so which rows are the reader's is an
// intersection done here.

import { getLeaderboard } from "../api/leaderboardApi.js";
import { getTasks } from "../api/metaApi.js";
import { getMyTeams } from "../api/teamApi.js";
import { dispose } from "../core/disposable.js";
import { renderHtml } from "../core/render.js";
import { loadModelMeta } from "../schemas/modelSchema.js";
import {
  loadTaskFields,
  trainingFieldKeys,
} from "../schemas/taskSubmissionSchema.js";
import {
  toLeaderboardRows,
  toTaskMetrics,
} from "../utils/leaderboardUtils.js";
import { createLeaderboardTable } from "../tables/leaderboardTable.js";
import {
  buildEmptyMessage,
  buildFailureMessage,
  buildInfoMessage,
} from "../components/messages.js";
import {
  buildHeader,
  buildPage,
  buildSections,
  getSectionBody,
} from "../components/sections.js";
import { createModelComparison } from "../comparisons/modelComparison.js";
import { createTableBinding } from "../comparisons/binding.js";
import { createLeaderboardFilters } from "../widgets/leaderboardFilters.js";
import { createTaskSelection } from "../widgets/taskSelection.js";
import { loadPage } from "../templates/page.js";
import { renderHeader, renderPage } from "../templates/pageChrome.js";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const TITLE = "Leaderboard";
const DESCRIPTION =
  "Public, completed submissions scored against held-out test data.";

const TASKS_SECTION = "board-tasks";
const FILTERS_SECTION = "board-filters";
const BOARD_SECTION = "board";
const COMPARE_SECTION = "board-compare";

// ─── FILTERS ─────────────────────────────────────────────────────────────────

// Off the schema, so a methodology field added there is read here.
const METHODOLOGY_KEYS = trainingFieldKeys();

// ─── PAGE ────────────────────────────────────────────────────────────────────

function renderLeaderboardPage({ tasks, myTeamIds }) {
  const available = tasks.map((task) => task.id).sort();
  const metrics = toTaskMetrics(tasks);

  renderPage(
    buildPage({
      header: buildHeader(),
      body: buildSections([
        {
          sections: [
            {
              id: TASKS_SECTION,
            },
            {
              id: FILTERS_SECTION,
            },
          ],
        },
        { id: BOARD_SECTION, title: "Standings" },

        // No button to enter: rows are picks from the start.
        { id: COMPARE_SECTION, title: "Compare models" },
      ]),
    }),
  );

  renderHeader(TITLE, DESCRIPTION);

  // Keyed by model id, which is what the table is indexed by, so a tick and a pick are one
  // key. `taskSubmissionIds` are the runs this row's scores came from: a filtered board stands
  // on the newest *matching* run, which is not always the newest.
  function toModelPick(row) {
    return {
      key: row.modelId,
      name: row.model_name,
      taskSubmissionIds: Object.values(row.scores ?? {}).map(
        (score) => score.task_submission_id,
      ),
    };
  }

  // The methodology fields, which the board's own scores do not carry.
  function methodologyOf(task) {
    if (!task) return null;

    return Object.fromEntries(
      METHODOLOGY_KEYS.map((key) => [key, task[key] ?? null]),
    );
  }

  // The board's own scores, looked up per render rather than carried on the pick: Apply
  // refetches the board under the picks.
  //
  // Narrowed to the chosen tasks — a row carries every score whatever is chosen. An empty set,
  // not null, for a model scoring none of them: null reads as "not arrived yet".
  //
  // Numbers stay the board's; methodology comes off this pick's own breakdown.
  function readScores(pick) {
    const scores = scoresByModel.get(String(pick.key));

    if (!scores) return null;

    const tasks = pick.detail?.tasks;

    return Object.fromEntries(
      chosen
        .filter((taskId) => scores[taskId])
        .map((taskId) => [
          taskId,
          tasks
            ? { ...scores[taskId], ...methodologyOf(tasks[taskId]) }
            : scores[taskId],
        ]),
    );
  }

  let standings = null;

  // What the board is ranked over. The widget holds it and rewrites the URL; this follows it.
  let chosen = [];

  // model id => its scores. Rebuilt with `standings`, the only thing that moves them.
  let scoresByModel = new Map();

  // Built with the page: the board is bound to it as soon as there is a board.
  const comparison = createModelComparison({
    container: getSectionBody(COMPARE_SECTION),
    toPick: toModelPick,
    readScores,
    showSuites: false,
  });

  // `claimLinks: false`: the model name still navigates; the rest of the row picks.
  const picking = createTableBinding(comparison, { claimLinks: false });

  // Picks the board no longer shows anything for: gone from the filtered field, or scored on
  // none of the chosen tasks. Survivors correct themselves through `readScores`.
  //
  // Declines to act on two states, neither of which is a field a pick can be off: no board,
  // and no chosen task.
  function dropDepartedPicks() {
    if (!standings || !chosen.length) return;

    for (const key of comparison.keys()) {
      const scores = scoresByModel.get(String(key));

      if (!scores || !chosen.some((taskId) => scores[taskId])) {
        comparison.drop(key);
      }
    }
  }

  // The departed go; survivors keep their place but forget what was fetched for them, which
  // was asked for by the old board's run ids.
  function settlePicks() {
    if (!standings) return;

    dropDepartedPicks();

    comparison.clearDetails();
  }

  // Replacing the section's contents detaches a Tabulator but does not free it: its registry
  // keeps the instance and its ResizeObserver alive, one orphan per redraw.
  let table = null;

  function renderBoard() {
    const body = getSectionBody(BOARD_SECTION);

    // Detached before destroy: the binding subscribes to the comparison, and a disposed table
    // left attached would be reconciled against on the next pick.
    picking.attach(null);

    dispose(table);
    table = null;

    if (!standings) {
      renderHtml(body, buildFailureMessage("The leaderboard failed to load."));

      return;
    }

    if (!chosen.length) {
      renderHtml(body, buildEmptyMessage("Choose a task to rank the board by."));

      return;
    }

    const rows = toLeaderboardRows(standings, chosen, myTeamIds);

    if (!rows.length) {
      renderHtml(body, buildEmptyMessage("No models have been scored yet."));

      return;
    }

    const mounted = createLeaderboardTable({
      rows,
      taskIds: chosen,
      metrics,
      // Selection behaviour is fixed at creation, so every rebuild asks for it again.
      selection: picking.selectionOptions(),
    });

    body.replaceChildren(mounted.element);
    table = mounted.table;

    // After the build, so ticks the comparison holds are put back on the rows carrying them.
    picking.attach(table);
  }

  // Fetched, not redrawn: ranks are computed over whatever survives the filter.
  function loadBoard() {
    filters.setBusy(true);

    renderHtml(
      getSectionBody(BOARD_SECTION),
      buildInfoMessage("Loading the board…"),
    );

    return getLeaderboard(filters.applied()).then((loaded) => {
      standings = loaded;
      scoresByModel = new Map(
        (loaded ?? []).map((standing) => [
          String(standing.model_id),
          standing.scores ?? {},
        ]),
      );

      // Before the board is built, so it is mounted against the surviving picks.
      settlePicks();

      renderBoard();

      // The picks kept their colours and their place; the numbers behind them did not.
      comparison.refresh();

      filters.setBusy(false);
    });
  }

  // Re-ranked in place: no fetch, since the scores behind the ranks do not move.
  // dropDepartedPicks first, so the board is mounted against the surviving picks.
  function chooseTasks(taskIds) {
    chosen = taskIds;

    dropDepartedPicks();

    renderBoard();

    comparison.refresh();
  }

  const filters = createLeaderboardFilters({
    container: getSectionBody(FILTERS_SECTION),

    hasBoard: () => Boolean(standings),

    onApply: loadBoard,
  });

  const selection = createTaskSelection({
    container: getSectionBody(TASKS_SECTION),
    available,
    onChange: chooseTasks,
  });

  chosen = selection.taskIds();

  // The controls are drawn from the task table already in hand, so they work before the
  // board arrives.
  return loadBoard();
}

loadPage({
  noun: "leaderboard",

  // Neither: the board is one URL for everyone, and it is about no particular record.
  requiresId: false,
  requiresAuth: false,

  load: async (id, { signedIn }) => {
    const [tasks, , , teams] = await Promise.all([
      getTasks(),
      loadTaskFields().catch(() => undefined),
      loadModelMeta().catch(() => undefined),
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
