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
import {
  getElement,
  refreshIcons,
  renderHtml,
  setText,
} from "../core/render.js";
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
import { buildButton, setButtonLabel } from "../components/buttons.js";
import { getIcon } from "../components/icons.js";
import {
  buildEmptyMessage,
  buildFailureMessage,
  buildInfoMessage,
} from "../components/messages.js";
import {
  attachCollapse,
  buildHeader,
  buildPage,
  buildSections,
  getSection,
  getSectionBody,
} from "../components/sections.js";
import { createModelComparison } from "../comparisons/modelComparison.js";
import { createTableBinding } from "../comparisons/binding.js";
import { createPanels } from "../components/panels.js";
import {
  buildFilterActions,
  createLeaderboardFilters,
} from "../widgets/leaderboardFilters.js";
import { createTaskSelection } from "../widgets/taskSelection.js";
import { loadPage } from "../templates/page.js";
import {
  CONTAINER_ID,
  renderHeader,
  renderPage,
} from "../templates/pageChrome.js";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const TITLE = "Leaderboard";
const DESCRIPTION =
  "Public, completed submissions scored against held-out test data.";

// The chips naming what is being compared, in the board's own header row — see picksContainer.
const PICKS_ID = "board-picks";

const COMPARE_ID = "compare-models";
const GO_ID = "go-to-comparison";

// The line beside the buttons saying what they are for — see getHint.
const HINT_ID = "compare-hint";

// Read out by the hint as well as worn by the buttons: a renamed button would otherwise
// leave the sentence naming one that is not there.
const COMPARE_LABEL = "Compare models";
const DONE_LABEL = "Done";
const GO_COMPARE_LABEL = "Go to comparison";
const GO_BOARD_LABEL = "Go to leaderboard";

// Switched by the button in the section's own header, so the header stays put whichever is on.
const BOARD_PANEL = "board-panel";
const COMPARE_PANEL = "compare-panel";

// The models being compared, as the compare pages name them.
const WITH_PARAM = "with";

const TASKS_SECTION = "board-tasks";
const FILTERS_SECTION = "board-filters";
const BOARD_SECTION = "board";

// ─── FILTERS ─────────────────────────────────────────────────────────────────

// Off the schema, so a methodology field added there is read here.
const METHODOLOGY_KEYS = trainingFieldKeys();

// ─── URL ─────────────────────────────────────────────────────────────────────

function readPicked() {
  const params = new URLSearchParams(location.search);

  return (params.get(WITH_PARAM) ?? "").split(",").filter(Boolean);
}

function writePicked(keys) {
  const url = new URL(location.href);

  if (keys.length) url.searchParams.set(WITH_PARAM, keys.join(","));
  else url.searchParams.delete(WITH_PARAM);

  history.replaceState(null, "", url);
}

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
              title: "Suites",
              description:
                "Select the suites or a combination of tasks to include in the ranking",
              compact: true,
              collapsible: true,
            },
            {
              id: FILTERS_SECTION,
              title: "Filters",
              description:
                "Apply filters to restrict models or tasks included in the ranking. Click more filters to show all",
              compact: true,
              collapsible: true,
              actions: buildFilterActions(),
            },
          ],
        },
        {
          id: BOARD_SECTION,

          // Opposite the buttons: what is being compared.
          controls: `<span class="row left gap-sm compare-picks" id="${PICKS_ID}"></span>`,


          // What pressing them does, then the buttons: the one that stays put reads
          // "Compare models", then "Done", and the other appears beside it.
          actions: [
            `<span class="metadata bold action-hint" id="${HINT_ID}"></span>`,
            buildButton({
              id: GO_ID,
              label: GO_COMPARE_LABEL,
              icon: getIcon("compare"),
              hidden: true,
              // Two is the fewest that is a comparison.
              disabled: true,
            }),
            buildButton({
              id: COMPARE_ID,
              label: COMPARE_LABEL,
              icon: getIcon("compare"),
              className: "primary-inv",
            }),
          ],
        },
      ]),
    }),
  );

  renderHeader(TITLE, DESCRIPTION);

  // Once, on the page: the toggles are delegated, and the comparison's own sections are
  // inside this container too.
  attachCollapse(CONTAINER_ID);

  // The two that are switched between. Plain elements rather than sections: the header above
  // them belongs to neither, so it stays put whichever is on — see getPanel in panels.js.
  renderHtml(
    getSectionBody(BOARD_SECTION),
    `<div id="${BOARD_PANEL}"></div><div id="${COMPARE_PANEL}"></div>`,
  );

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
    container: getElement(COMPARE_PANEL),
    toPick: toModelPick,
    readScores,

    // Its own panel is not the only thing on the page: the chips read beside the buttons that
    // switch to them.
    picksContainer: PICKS_ID,
  });

  // `claimLinks: false`: the model name still navigates; the rest of the row picks.
  // Whether the board's rows can be picked, and the only state the comparison is reachable
  // in. Open from the start where a shared URL names picks.
  let comparing = readPicked().length > 0;

  // Named in the URL and taken up once the rows carrying them are in hand — see applyPicked.
  let wanted = readPicked();

  const picking = createTableBinding(comparison, {
    claimLinks: false,
    enabled: () => comparing,
  });

  // The board and the comparison, one at a time.
  const panels = createPanels({
    panels: [BOARD_PANEL, COMPARE_PANEL],

    // The comparison is unreachable with nothing picked, which is what returns the reader to
    // the board when the last pick is dropped.
    hasContent: (id) => id === BOARD_PANEL || comparison.size > 0,

    // And unreachable until they ask to compare, which is what keeps the way into it shut
    // while the board is only being read.
    isVisible: (id) => id === BOARD_PANEL || comparing,
  });

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
  let boardRoot = null;

  // The picks a shared URL names, taken up once. Later rebuilds leave the set alone.
  function applyPicked(rows) {
    if (!wanted.length) return;

    const byKey = new Map(rows.map((row) => [String(row.modelId), row]));

    comparison.setPicks(wanted.map((key) => byKey.get(key)).filter(Boolean));

    wanted = [];

    if (comparison.size) {
      panels.select(COMPARE_PANEL);
      updateComparing();
    }
  }

  function renderBoard() {
    const body = getElement(BOARD_PANEL);

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
    boardRoot = mounted.element;

    applyPicked(rows);

    // After the build, so ticks the comparison holds are put back on the rows carrying them.
    picking.attach(table);
  }

  // What the buttons beside it are for: how to start comparing, and once the reader has,
  // how many are in and which button goes where.
  function getHint(showingComparison) {
    if (!comparing) {
      return `Click ${COMPARE_LABEL} and select up to ${comparison.max} models to compare their performance.`;
    }

    // The way out is the same button either way; the way across is whichever panel is off.
    const across = showingComparison
      ? `Click ${GO_BOARD_LABEL} to pick more models`
      : `Click ${GO_COMPARE_LABEL} to see the comparison`;

    return `Selected ${comparison.size} out of ${comparison.max}. ${across}, or ${DONE_LABEL} to return to the leaderboard.`;
  }

  // The heading, the buttons and the row cursor all say the same thing. The panels first,
  // since which one is on decides what the rest of them read.
  function updateComparing() {
    panels.render();

    const showingComparison = panels.active() === COMPARE_PANEL;

    // The controls above narrow the board: on the comparison they are still worth reading and
    // not worth pressing. `inert` is the platform's own — it takes them out of the tab order
    // and off the pointer, and `.page-section[inert]` is what fades them.
    for (const id of [TASKS_SECTION, FILTERS_SECTION]) {
      const section = getSection(id);

      if (section) section.inert = showingComparison;
    }

    const compare = getElement(COMPARE_ID);

    setButtonLabel(compare, {
      label: comparing ? DONE_LABEL : COMPARE_LABEL,
      icon: getIcon(comparing ? "cancel" : "compare"),
    });

    const go = getElement(GO_ID);

    go.hidden = !comparing;

    // A pick is the fewest that is a comparison — but going back to the board is always live.
    go.disabled = !showingComparison && comparison.size < 1;

    setButtonLabel(go, {
      label: showingComparison ? GO_BOARD_LABEL : GO_COMPARE_LABEL,
      icon: getIcon(showingComparison ? "leaderboard" : "compare"),
    });

    // One of them is lit, and it is always the way on: Compare until the reader is
    // comparing, then Go from the first pick — filled, since by then it is the one thing
    // left to do. Done is the way back out, so it stays plain.
    compare.classList.toggle("primary-inv", !comparing);
    go.classList.toggle("primary", comparison.size > 0);

    setText(getElement(HINT_ID), getHint(showingComparison));

    if (boardRoot) boardRoot.dataset.rowsSelectable = String(comparing);

    refreshIcons();
  }

  function attachEvents() {
    getElement(COMPARE_ID).addEventListener("click", () => {
      comparing = !comparing;

      // Done gives the picks up: the ticks come off the board and `with=` leaves the URL,
      // so pressing Compare again starts on a clean board.
      if (!comparing) {
        comparison.clear();
        panels.select(BOARD_PANEL);
      }

      updateComparing();
    });

    // The one control that switches them, so it says where it goes rather than what it is.
    getElement(GO_ID).addEventListener("click", () => {
      panels.select(
        panels.active() === COMPARE_PANEL ? BOARD_PANEL : COMPARE_PANEL,
      );

      updateComparing();
    });
  }

  // Fetched, not redrawn: ranks are computed over whatever survives the filter.
  function loadBoard() {
    filters.setBusy(true);

    renderHtml(getElement(BOARD_PANEL), buildInfoMessage("Loading the board…"));

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

  comparison.subscribe(() => {
    writePicked(comparison.keys());
    updateComparing();
  });

  const selection = createTaskSelection({
    container: getSectionBody(TASKS_SECTION),
    available,
    onChange: chooseTasks,
  });

  chosen = selection.taskIds();

  attachEvents();
  updateComparing();

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
