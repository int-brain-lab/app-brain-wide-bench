// Page entry for html/leaderboard/leaderboard.html.
//
// Fetch the board, map it once, then hand the rows to the table. The rows and the ranking over
// them are utils/leaderboardUtils.js and the columns are tables/leaderboardTable.js.
//
// Two controls above it: which tasks the board is ranked over — widgets/taskSelection.js — and
// what narrows the field. Re-ranking needs no request, since the server sends a rank per task
// and the mean is recomputed here; narrowing the field needs one, because the ranks come back
// computed over whatever survives it.
//
// Under the board is the model comparison, and only that: a row is a pick from the moment the
// page loads — see comparisons/recordComparison.js for the three panels behind its tabs.
//
// It also owns the reader's own team ids. /api/leaderboard has no notion of a caller, so
// marking which rows are the reader's is an intersection done here.

import { getLeaderboard } from "../api/leaderboardApi.js";
import { getTasks } from "../api/metaApi.js";
import { getMyTeams } from "../api/teamApi.js";
import { dispose } from "../core/disposable.js";
import { getElement, refreshIcons, renderHtml } from "../core/render.js";
import { formatCount } from "../core/utils.js";
import { MODEL_FIELDS, loadModelMeta } from "../schemas/modelSchema.js";
import {
  TASK_FIELDS,
  loadTaskFields,
  trainingFieldKeys,
} from "../schemas/taskSubmissionSchema.js";
import {
  toLeaderboardRows,
  toTaskMetrics,
} from "../utils/leaderboardUtils.js";
import { createLeaderboardTable } from "../tables/leaderboardTable.js";
import { buildButton, setButtonLabel } from "../components/buttons.js";
import { buildFilterControl } from "../components/filters.js";
import { createFilterState } from "../components/filterState.js";
import { getIcon } from "../components/icons.js";
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
import { bindTableSelection } from "../comparisons/comparison.js";
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

const APPLY_ID = "apply-filters";
const CLEAR_ID = "clear-filters";
const MORE_ID = "more-filters";

// The two halves of the filter row, as containers rather than as markup: they are what the
// controls are written into, so the three buttons on the row beside them keep their listeners
// while the controls are rewritten.
//
// The second is shown and hidden rather than built and dropped, so what a reader has pinned in
// it survives being folded away.
const LEAD_LISTS_ID = "lead-filter-lists";
const MORE_LISTS_ID = "more-filter-lists";

const MORE_LABEL = "Show more filters";
const FEWER_LABEL = "Show fewer filters";

// ─── FILTERS ─────────────────────────────────────────────────────────────────

// Only the two answers. A model whose flag was never filled in matches neither, because the
// endpoint reads an unanswered question as not a "no".
const PRETRAINED_OPTIONS = [
  { value: "true", label: "Pretrained" },
  { value: "false", label: "Not pretrained" },
];

// What the model itself is, beside the flag: what it was pretrained on and what it was
// pretrained to produce.
const MODEL_KEYS = ["pretrained_in_modalities", "pretrained_out_modalities"];

// How a task was produced: the methodology panel of a task submission, whatever it holds. Read
// off the schema, so a field added there is a filter here without a second edit.
const METHODOLOGY_KEYS = trainingFieldKeys();

/**
 * Every filter the board can be narrowed by, in the order they are drawn.
 *
 * No `match`: these are the server's, since a narrowed field is a different set of ranks.
 * `fold` marks the ones behind "Show more filters" — the first three are what a reader asks
 * first, and five more on the row at rest would bury them.
 *
 * Options come from the server's own enums, filled into both schemas in place — see
 * loadModelMeta and loadTaskFields, which is why this is read after the page's own load.
 *
 * @returns the controls — see components/filterState.js.
 */
function filterControls() {
  return [
    {
      type: "pinned",
      name: "pretrained",
      label: "Pretrained",
      options: PRETRAINED_OPTIONS,
    },
    ...MODEL_KEYS.map((key) => ({
      type: "pinned",
      name: key,
      label: MODEL_FIELDS[key].label,
      options: MODEL_FIELDS[key].options ?? [],
    })),

    // The parameter count is logarithmic: it runs from a thousand to two hundred billion, and
    // on a linear track a step is either invisible at the bottom or a hundred million at the
    // top. Which is also why it reads 1.2K and 200B rather than in full.
    {
      type: "range",
      name: "n_parameters",
      label: "Parameters",
      range: { min: 1e3, max: 2e11, scale: "log" },
      format: formatCount,
      fold: true,
    },
    {
      type: "range",
      name: "temporal_context_s",
      label: "Temporal context",
      range: { min: 0, max: 20, step: 0.5 },
      format: (value) => `${value} s`,
      fold: true,
    },
    ...METHODOLOGY_KEYS.map((key) => ({
      type: "pinned",
      name: key,
      label: TASK_FIELDS[key].label,
      options: TASK_FIELDS[key].options ?? [],
      fold: true,
    })),
  ];
}

// The three at rest on a row with the three buttons, and the rest folded away under them. The
// buttons belong to the row rather than to the section's header, so they are built once and
// still found by id after the controls beside them have been replaced.
function buildFilterShell() {
  return `
    <div class="column gap-md">
      <div class="grid-3" id="${LEAD_LISTS_ID}"></div>
      <div class="grid-3" id="${MORE_LISTS_ID}" hidden></div>
    </div>
  `;
}

// `inline-select` for the three on the row, which have to leave room for the buttons beside
// them; nothing for the ones in the grid, whose cell is already a third of the section.
function buildFilterColumns(controls, values, className = "") {
  return controls
    .map((control) =>
      buildFilterControl({ control, value: values[control.name], className }),
    )
    .join("");
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
            { id: TASKS_SECTION, title: "Select tasks" },
            {
              id: FILTERS_SECTION,
              title: "Apply filters",
              actions: [
                buildButton({
                  id: MORE_ID,
                  label: MORE_LABEL,
                  icon: getIcon("expand"),
                }),
                buildButton({
                  id: CLEAR_ID,
                  label: "Clear filters",
                  icon: getIcon("cancel"),
                  // Nothing to clear until a control holds something.
                  disabled: true,
                }),
                buildButton({
                  id: APPLY_ID,
                  label: "Apply filters",
                  icon: getIcon("filter"),
                  // Nothing to apply until a control differs from what the board was
                  // fetched with.
                  disabled: true,
                }),
              ],
            },
          ],
        },
        { id: BOARD_SECTION, title: "Standings" },

        // No button to enter: the board's rows are picks from the start, and the panel's own
        // prompt is what says so.
        { id: COMPARE_SECTION, title: "Compare models" },
      ]),
    }),
  );

  renderHeader(TITLE, DESCRIPTION);

  // A row is one model, and the model is what the table is indexed by — so a tick and a pick
  // are the same key, and the comparison's own cache key is that key too. The rest is what it
  // shows before its fetch lands.
  //
  // The ids are the entries this row's scores came from, so what the comparison fetches
  // describes what the board ranked rather than whatever is newest by the time it is asked —
  // a filtered board stands on the newest *matching* entry, which is not always the newest.
  function toModelEntry(row) {
    return {
      key: row.modelId,
      recordId: row.modelId,
      name: row.model_name,
      teamName: row.team_name,
      taskSubmissionIds: Object.values(row.scores ?? {}).map(
        (score) => score.task_submission_id,
      ),
    };
  }

  // The five methodology fields off a task, and nothing else — what the board's own scores
  // don't carry, since putting them on every row of a public board is most of its payload for
  // something only a compared model is read closely enough to want.
  function methodologyOf(task) {
    if (!task) return null;

    return Object.fromEntries(
      METHODOLOGY_KEYS.map((key) => [key, task[key] ?? null]),
    );
  }

  // The board's own scores, so a comparison and the rows it was picked from cannot disagree:
  // already the newest entry per task that matches the applied filters, and already
  // public-only. Looked up on every render rather than carried on the entry — Apply refetches
  // the board under the picks, and the selection keeps the entry object it already holds.
  //
  // Narrowed to the tasks the board is ranked over, which is the other half of that: a row
  // carries every score whatever is chosen, so without this the panel would plot tasks the
  // rank beside them was not computed from. The comparison's own suite select then narrows
  // what is left, and the two compose — a suite with no chosen task simply isn't offered.
  //
  // A model with nothing on the chosen tasks comes back as an empty set rather than as null,
  // which is the difference between "scored none of these" and "its scores have not arrived":
  // the first is kept and drawn as dashes, since it was explicitly picked — see
  // toCompareEntries.
  //
  // The numbers stay the board's; how each was produced comes off the breakdown fetched for
  // this pick, by the same entry ids. So a failed fetch costs the tooltip its methodology
  // rather than the plot its bars — and `clearDetails` on Apply is what keeps the two halves
  // describing one set of runs.
  function scoresOf(entry) {
    const scores = scoresByModel.get(String(entry.recordId));

    if (!scores) return null;

    const tasks = entry.detail?.tasks;

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

  const controls = filterControls();

  const lead = controls.filter((control) => !control.fold);
  const folded = controls.filter((control) => control.fold);

  // The controls hold what is pending; `applied` is what the board on screen was fetched
  // with, and the difference between the two is what the Apply button is for.
  const filters = createFilterState({
    controls,
    root: getSectionBody(FILTERS_SECTION),
    onChange: updateFilterButtons,
  });

  let applied = filters.readUrl();
  let standings = null;

  // What the board is ranked over. The widget holds it and rewrites the URL; this follows it.
  let chosen = [];

  // model id => its scores, off the board in hand. Rebuilt with `standings`, which is the
  // only thing that moves them: the task choice picks which tasks are *ranked*, and a row
  // carries every score either way.
  let scoresByModel = new Map();

  // The one panel under the board, built with the page rather than on first use: the board is
  // bound to it as soon as there is a board, and there is no longer a second panel to switch
  // to — the comparison is what a picked row opens, from the moment the page loads.
  const comparison = createModelComparison({
    container: getSectionBody(COMPARE_SECTION),
    toEntry: toModelEntry,
    scoresOf,
    showSuites: false,
  });

  // `claimLinks: false`: the model name still goes to the model's own page, and a click
  // anywhere else on the row is a pick. The board is always picking now, so it cannot also be
  // the thing that swallows the one link a row carries.
  const picking = bindTableSelection(comparison, { claimLinks: false });

  // A pick the board no longer shows anything for: its model has left the filtered field, or
  // the tasks it was scored on are no longer among the chosen ones. Either way the comparison
  // would hold a model whose every column is a dash, which reads as a model that scored
  // nothing rather than as one the reader has stopped looking at.
  //
  // The survivors correct themselves — the comparison reads its scores through `scoresOf` on
  // every render — so only the departed have to be dropped by hand.
  //
  // Two states this declines to judge, because neither is a field a pick can be off: a board
  // that failed to load, where acting would lose the reader's picks to a network error, and no
  // chosen task at all, where the reader is between choices rather than looking at an empty
  // board.
  function dropDepartedPicks() {
    if (!standings || !chosen.length) return;

    for (const key of comparison.keys()) {
      const scores = scoresByModel.get(String(key));

      if (!scores || !chosen.some((taskId) => scores[taskId])) {
        comparison.drop(key);
      }
    }
  }

  // What a re-filtered board does to the picks under it: the departed go, and the survivors
  // keep their place but forget what was fetched for them — that was asked for by the old
  // board's entry ids, and while the values they draw are the board's and correct themselves,
  // the methodology in their tooltips does not.
  function settlePicks() {
    if (!standings) return;

    dropDepartedPicks();

    comparison.clearDetails();
  }

  // Replacing the section's contents detaches a Tabulator's element but doesn't free it: its
  // own registry keeps the instance and its ResizeObserver alive, one orphan per redraw.
  let table = null;

  function renderBoard() {
    const body = getSectionBody(BOARD_SECTION);

    // Detached before it is destroyed: the binding holds the instance and subscribes to the
    // comparison, so a disposed table left attached would be reconciled against on the next
    // pick — see destroyTable in templates/listView.js.
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
      // Selection behaviour is fixed when a Tabulator is created, which is why every rebuild
      // of the board asks the binding for it again rather than reconfiguring what is there.
      selection: picking.selection(),
    });

    body.replaceChildren(mounted.element);
    table = mounted.table;

    // Attached after the build, so the ticks the comparison already holds are put back on the
    // rows that carry them — a board rebuilt by a task change keeps its picks.
    picking.attach(table);
  }

  // Whether the five behind the button are showing. Held rather than read back off the
  // element, because the button beside them has to say which way it goes next — one answer,
  // used by the fold and by the label.
  let showingMore = false;

  // The fold, and the button that says which way it goes next. The container is the thing
  // hidden, not what is in it, so folding is independent of what the lists currently say.
  function renderMore() {
    const more = getElement(MORE_LISTS_ID);

    if (more) more.hidden = !showingMore;

    setButtonLabel(getElement(MORE_ID), {
      label: showingMore ? FEWER_LABEL : MORE_LABEL,
      icon: getIcon(showingMore ? "collapse" : "expand"),
    });

    refreshIcons();
  }

  // Written with whatever the controls should now say: what the board was fetched with at
  // first, and the defaults when Clear puts them back. Both halves in one call, because they
  // are one set of values — a Clear that put back only the half in view would leave the other
  // still narrowing the board. `refresh` because a chip carries a ✕.
  function renderFilters(values) {
    renderHtml(
      getElement(LEAD_LISTS_ID),
      buildFilterColumns(lead, values, "inline-select"),
      { refresh: true },
    );

    renderHtml(
      getElement(MORE_LISTS_ID),
      buildFilterColumns(folded, values),
      { refresh: true },
    );

    filters.mark();
  }

  function applyButton() {
    return getElement(APPLY_ID);
  }

  function clearButton() {
    return getElement(CLEAR_ID);
  }

  // Apply has something to do when the controls differ from what the board was fetched with —
  // or when there is no board, since one that failed to load is worth asking for again with
  // the same filter.
  //
  // Clear resets both, so it has something to do while either holds a filter: the controls
  // unpinned by hand still leave a narrowed board to put back.
  function updateFilterButtons() {
    const pending = filters.read();
    const empty = filters.empty();

    const apply = applyButton();
    const clear = clearButton();

    if (apply) {
      apply.disabled = Boolean(standings) && filters.same(pending, applied);
    }

    if (clear) {
      clear.disabled =
        filters.same(pending, empty) && filters.same(applied, empty);
    }
  }

  // What the board now asks for: recorded in the URL so the view can be sent, and fetched.
  // The two go together — a URL naming one field beside a board showing another is the one
  // state this page must never be in — which is the whole reason this is not two calls at
  // each of the buttons.
  function applyFilters(values) {
    applied = values;

    filters.writeUrl(applied);

    return loadBoard();
  }

  // The board is fetched, not redrawn: the ranks are computed over whatever survives the
  // filter, so a narrowed field is a different set of numbers.
  function loadBoard() {
    for (const button of [applyButton(), clearButton()]) {
      if (button) button.disabled = true;
    }

    renderHtml(
      getSectionBody(BOARD_SECTION),
      buildInfoMessage("Loading the board…"),
    );

    return getLeaderboard(applied).then((loaded) => {
      standings = loaded;
      scoresByModel = new Map(
        (loaded ?? []).map((standing) => [
          String(standing.model_id),
          standing.scores ?? {},
        ]),
      );

      // Before the board is built, so the table is mounted against the picks that survived
      // the new filter rather than against the ones that made it.
      settlePicks();

      renderBoard();

      // The picks that survived kept their colours and their place; the numbers behind them
      // did not.
      comparison.refresh();

      // Live again only where pressing one would do something: a board that failed to load is
      // worth asking for again with the same filter, one that arrived is not.
      updateFilterButtons();
    });
  }

  function attachEvents() {
    // By id like the two beside it: the shell it sits in is written once, and only the
    // containers either side of it are rewritten.
    getElement(MORE_ID)?.addEventListener("click", () => {
      showingMore = !showingMore;

      renderMore();
    });

    // The controls and the board together, so one press is the whole way back to the full
    // field rather than a press and then Apply.
    clearButton()?.addEventListener("click", () => {
      const cleared = filters.empty();

      // Before the fetch, so what the controls say and what was asked for agree by the time
      // the board lands and the buttons are judged against them.
      renderFilters(cleared);

      applyFilters(cleared);
    });

    applyButton()?.addEventListener("click", () => {
      applyFilters(filters.read());
    });
  }

  // What a task change does: the board is re-ranked over the new set and the panel is drawn
  // over the same tasks. No fetch — the ranks move, the scores behind them do not.
  //
  // dropDepartedPicks before the board is rebuilt, so it is mounted against the picks that
  // survived the new choice rather than against the ones that made it.
  function chooseTasks(taskIds) {
    chosen = taskIds;

    dropDepartedPicks();

    renderBoard();

    comparison.refresh();
  }

  // The shell before the controls it holds, and before attachEvents, which finds the three
  // buttons on its row by id.
  renderHtml(getSectionBody(FILTERS_SECTION), buildFilterShell());

  const selection = createTaskSelection({
    container: getSectionBody(TASKS_SECTION),
    available,
    onChange: chooseTasks,
  });

  chosen = selection.taskIds();

  renderFilters(applied);
  renderMore();
  attachEvents();

  // The controls are drawn from the task table, which is already in hand, so they are usable
  // before the board arrives — and the board is what every later render replaces.
  return loadBoard();
}

loadPage({
  noun: "leaderboard",

  // Neither: the board is one URL for everyone, and it is about no particular record.
  requiresId: false,
  requiresAuth: false,

  load: async (id, { signedIn }) => {
    // The task table is what the columns are built from, and it doesn't change with the
    // choice — only which of them are shown does. A failure here is the page failing, which
    // is loadPage's to report.
    //
    // `loadTaskFields` costs no second request: it awaits the same memoised /api/meta that
    // getTasks does, and fills the methodology fields' options in place from the server's own
    // enums — so a new modality is a filter option without a change here.
    //
    // The memberships are fetched only when there is a session to fetch them for, and a
    // failure leaves the set empty: the board then renders without the "Yours" pill rather
    // than not at all.
    // Caught rather than allowed to reject: it fails only when /api/meta does, and getTasks
    // is already the one reporting that — so the failure reads the same as it always did,
    // rather than becoming a page error because a second caller of the same request threw.
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
