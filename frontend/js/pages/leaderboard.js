// Page entry for html/leaderboard/leaderboard.html.
//
// Fetch the board, map it once, then hand the rows to the table. The rows and the ranking
// over them are utils/leaderboardUtils.js and the columns are tables/leaderboardTable.js;
// what this page owns is which tasks the board is ranked over.
//
// Two lists above it, and only one of them decides anything: the tasks. The suites are a
// shortcut into that list — ticking one ticks its tasks — because a reader almost always
// wants a whole suite and occasionally wants part of one. Re-ranking needs no request: the
// server sends a rank per task and ranking a model within a task doesn't depend on which
// other tasks are on screen, so the mean is recomputed here.
//
// It also owns the reader's own team ids. /api/leaderboard has no notion of a caller — that
// is what keeps one public board cacheable — so marking which rows are the reader's is an
// intersection done here, from a second request for their memberships.

import { getLeaderboard } from "../api/leaderboardApi.js";
import { getTasks } from "../api/metaApi.js";
import { getMyTeams } from "../api/teamApi.js";
import { dispose } from "../core/disposable.js";
import { getElement, refreshIcons, renderHtml } from "../core/render.js";
import {
  SUITES,
  suiteFromTask,
  suiteLabel,
  taskLabel,
} from "../core/suites.js";
import {
  buildEmptyMessage,
  buildFailureMessage,
  buildInfoMessage,
} from "../components/messages.js";
import {
  buildPinnedSelect,
  pinFromEvent,
  pinnedIn,
} from "../components/filters.js";
import {
  COMPARE_BUTTON_ID,
  buildButton,
  buildCompareButton,
} from "../components/buttons.js";
import { getIcon } from "../components/icons.js";
import { createModelBreakdown } from "../comparisons/modelBreakdown.js";
import { createModelComparison } from "../comparisons/modelComparison.js";
import { bindTableSelection } from "../comparisons/comparison.js";
import {
  buildHeader,
  buildPage,
  buildSections,
  getSection,
  getSectionBody,
} from "../components/sections.js";
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
import { loadPage } from "../templates/page.js";
import { renderHeader, renderPage } from "../templates/pageChrome.js";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const TITLE = "Leaderboard";
const DESCRIPTION =
  "Public, completed submissions scored against held-out test data.";

const TASKS_SECTION = "board-tasks";
const FILTERS_SECTION = "board-filters";
const BOARD_SECTION = "board";
const BREAKDOWN_SECTION = "board-breakdown";
const COMPARE_SECTION = "board-compare";

// The two panels under the board, one at a time. Not a matter of taste: selection behaviour
// is fixed when a Tabulator is created — the breakdown holds one row, rolls it over and
// leaves the model link alone, the comparison holds five and claims the link — so switching
// rebuilds the board rather than reconfiguring it.
const BREAKDOWN = "breakdown";
const COMPARE = "compare";

// The lists are found by `data-role`, not by the bar's `data-filter`: neither narrows rows,
// and a delegated listener must never mistake one for a filter control.
// One control per suite, found by the suite's own id — so a change says which suite moved
// without a lookup, and the tasks a control offers are exactly the ones its chips can hold.
//
// The control above them takes whole suites, and is named rather than keyed by a suite so that
// a pin in it is never mistaken for a pin in one of theirs.
const SUITE_LIST = "suite";
const PRETRAINED = "pretrained";
const HOOK = "role";

const APPLY_ID = "apply-filters";
const CLEAR_ID = "clear-filters";

// Hardcoded rather than derived from the rows: an option that disappeared exactly when
// nothing on the board matched it would be the one worth offering.
//
// Only the two answers. A model whose flag was never filled in matches neither, because the
// endpoint reads an unanswered question as not a "no" — so it is in the board only while this
// is left alone.
const PRETRAINED_OPTIONS = [
  { value: "true", label: "Pretrained" },
  { value: "false", label: "Not pretrained" },
];

// What the model itself is, beside the flag: what it was pretrained on and what it was
// pretrained to produce. Named rather than read off a panel, because the specification panel
// holds parameters and prose as well, and only these two are answers a reader would narrow by.
const MODEL_KEYS = ["pretrained_in_modalities", "pretrained_out_modalities"];

// How a task was produced: the methodology panel of a task submission, whatever it holds. Read
// off the schema rather than written out here, so a field added there is a filter here without
// a second edit.
//
// The two lists are different grains, and phase two's query will have to keep them apart: the
// model's narrow which models are in the field at all, while a task's narrow which of a model's
// entries survive — so a model can stay on the board with only some of its tasks.
const METHODOLOGY_KEYS = trainingFieldKeys();

// Every list the board can be narrowed by, in the order they are drawn: the model's own three
// first, then how each task was produced. Read, built and read back from this one list, so the
// three can't fall out of step.
//
// Options come from the server's own enums, filled into both schemas in place — see
// loadModelMeta and loadTaskFields.
function filterLists() {
  return [
    { name: PRETRAINED, label: "Pretrained", options: PRETRAINED_OPTIONS },
    ...MODEL_KEYS.map((key) => ({
      name: key,
      label: MODEL_FIELDS[key].label,
      options: MODEL_FIELDS[key].options ?? [],
    })),
    ...METHODOLOGY_KEYS.map((key) => ({
      name: key,
      label: TASK_FIELDS[key].label,
      options: TASK_FIELDS[key].options ?? [],
    })),
  ];
}

// What a shareable board is: which tasks it is ranked over. The suites are not in the URL —
// they are a way of ticking tasks, and the tasks say what was ticked.
// Each filter is its own parameter, named after the list that fills it — see filterLists.
const TASKS_PARAM = "tasks";

// ─── STATE ───────────────────────────────────────────────────────────────────

function readTasks(available) {
  const asked = (
    new URLSearchParams(location.search).get(TASKS_PARAM) ?? ""
  ).split(",");

  const known = asked.filter((taskId) => available.includes(taskId));

  // Every task by default: the board opens on the whole benchmark, and narrowing is the
  // reader's to ask for.
  return known.length ? known : available;
}

function writeTasks(taskIds, available) {
  const url = new URL(location.href);

  // Nothing in the URL for the default, so a shared link is the short one until the reader
  // has actually chosen something.
  if (taskIds.length === available.length) url.searchParams.delete(TASKS_PARAM);
  else url.searchParams.set(TASKS_PARAM, taskIds.join(","));

  history.replaceState(null, "", url);
}

// Every filter the board can be narrowed by, as one object: the flag, and a list per
// methodology field. Kept together because they are applied together — one button, one
// request, one set of ranks.
function readFilters() {
  const params = new URLSearchParams(location.search);
  const filters = {};

  for (const { name, options } of filterLists()) {
    const known = options.map((option) => option.value);

    // Checked against what the schema offers, so a stale link can't tick a box that no longer
    // exists — or a value the server would refuse.
    filters[name] = (params.get(name) ?? "")
      .split(",")
      .filter((value) => known.includes(value));
  }

  return filters;
}

// replaceState, not pushState: working a filter shouldn't build a stack of history entries to
// press Back through. The URL still survives a refresh and can still be sent.
function writeFilters(filters) {
  const url = new URL(location.href);

  for (const [key, value] of Object.entries(filters)) {
    const asked = Array.isArray(value) ? value.join(",") : value;

    if (asked) url.searchParams.set(key, asked);
    else url.searchParams.delete(key);
  }

  history.replaceState(null, "", url);
}

// Every filter at rest: no values, which is what the endpoint reads as no filter and what a
// bare URL produces. What Clear puts the controls back to.
function emptyFilters() {
  return Object.fromEntries(filterLists().map(({ name }) => [name, []]));
}

// Whether two sets of filters would ask the same question, which is what decides whether the
// Apply button has anything to do.
function sameFilters(left, right) {
  return Object.keys(left).every((key) =>
    Array.isArray(left[key])
      ? left[key].join(",") === right[key].join(",")
      : left[key] === right[key],
  );
}

// ─── LISTS ───────────────────────────────────────────────────────────────────

// One list per suite, in SUITES order and with only the suites that have a task. The task
// labels drop the suite prefix, which the control they sit under carries instead.
function toSuiteLists(taskIds) {
  return SUITES.map((suite) => ({
    suite,
    label: suiteLabel(suite),
    options: taskIds
      .filter((taskId) => suiteFromTask(taskId) === suite)
      .map((taskId) => ({
        value: taskId,
        label: taskLabel(taskId),
      })),
  })).filter((list) => list.options.length);
}

// A suite is pinned while every one of its tasks is: a part-chosen suite is not chosen,
// because pinning it is what chooses all of them. Derived rather than held, so the suite
// control can never say something the task controls under it contradict.
function suitesOf(taskIds, bySuite) {
  return [...bySuite.keys()].filter((suite) =>
    bySuite.get(suite).every((taskId) => taskIds.includes(taskId)),
  );
}

/**
 * The chosen tasks after the suite control was left saying `suites`.
 *
 * A suite stands for its own tasks and no others: pinning one adds them and leaves the rest
 * alone — a reader adding TS2 to a part-chosen TS1 means "and TS2", not "only TS2" — and
 * unpinning one takes them away, part-chosen or not.
 *
 * Which suite moved is the difference between what the chips now say and what the chosen
 * tasks implied, since only one of them can move per event.
 */
function withSuites(taskIds, suites, bySuite) {
  const before = suitesOf(taskIds, bySuite);

  let chosen = taskIds;

  for (const suite of suites.filter((suite) => !before.includes(suite))) {
    const own = bySuite.get(suite) ?? [];

    chosen = [...chosen, ...own.filter((taskId) => !chosen.includes(taskId))];
  }

  for (const suite of before.filter((suite) => !suites.includes(suite))) {
    const own = bySuite.get(suite) ?? [];

    chosen = chosen.filter((taskId) => !own.includes(taskId));
  }

  return chosen;
}

// The whole suites first, then one control per suite: each offers that suite's tasks and pins
// the ones the board is ranked over. A suite is its own control rather than a heading inside a
// shared one, so what a select offers is exactly what its chips can hold — and the one above
// them is how a reader takes a suite on or off without naming its tasks one at a time.
//
// The placeholders are instructions here, not the filters' "Any": nothing pinned means nothing
// of that suite is ranked, which is a choice rather than the absence of one.
function buildLists(available, taskIds, bySuite) {
  const lists = toSuiteLists(available);

  return `
    <div class="column gap-md">
      ${buildPinnedSelect({
        name: SUITE_LIST,
        hook: HOOK,
        label: "Whole suites",
        options: lists.map(({ suite, label }) => ({ value: suite, label })),
        selected: suitesOf(taskIds, bySuite),
        placeholder: "Add a suite",
      })}
      <div class="grid-${Math.min(lists.length, 3) || 1}">
        ${lists
          .map(({ suite, label, options }) =>
            buildPinnedSelect({
              name: suite,
              hook: HOOK,
              label,
              options,
              selected: taskIds.filter(
                (taskId) => suiteFromTask(taskId) === suite,
              ),
              placeholder: `Add a ${label} task`,
            }),
          )
          .join("")}
      </div>
    </div>`;
}

// ─── COMPARING ───────────────────────────────────────────────────────────────

// Lit while the board's rows are picks rather than links, matching the list pages' own
// compare button — see toggleComparison in templates/listView.js.
function markComparing(on) {
  getElement(COMPARE_BUTTON_ID)?.classList.toggle("primary", on);
}

// ─── FILTERS ─────────────────────────────────────────────────────────────────

// The filter and the button that applies it. Applied on the button rather than on the
// dropdown, because narrowing the field is a request: the ranks come back computed over
// whatever survives, so a change here is a new board rather than a redraw of this one.
//
// Which is also why the controls above apply themselves — those need no request, and a
// control that waits when it doesn't have to is a control that reads as broken.
//
// One control per thing that can be narrowed, under its own label — the model's own flag
// first, then how each task was produced.
//
// Every one narrows by *any of* what is pinned: "supervised or self-supervised" is a question
// a reader has, and "supervised" is the same question with one chip.
function buildFilters(filters) {
  // Three across, which puts the model's own three on the first row and the task's five under
  // them — the grouping is the order rather than a heading over each half.
  //
  // A pinned select rather than a list of boxes: eight fields of up to five options each is
  // forty boxes on screen before the reader has asked for anything, where these are eight
  // closed selects that grow only where something is picked.
  return `
    <div class="grid-3">
      ${filterLists()
        .map(({ name, label, options }) =>
          buildPinnedSelect({
            name,
            hook: HOOK,
            label,
            options,
            selected: filters[name],
          }),
        )
        .join("")}
    </div>`;
}

// ─── PAGE ────────────────────────────────────────────────────────────────────

function renderLeaderboardPage({ tasks, myTeamIds }) {
  renderPage(
    buildPage({
      header: buildHeader(),
      body: buildSections([
        { id: TASKS_SECTION, title: "Ranked over" },
        {
          id: FILTERS_SECTION,
          title: "Filters",
          actions: [
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
              // Nothing to apply until a control differs from what the board was fetched with.
              disabled: true,
            }),
          ],
        },
        {
          id: BOARD_SECTION,
          title: "Standings",
          actions: [buildCompareButton({ label: "Compare models" })],
        },
        { id: BREAKDOWN_SECTION, title: "Model breakdown" },
        { id: COMPARE_SECTION, title: "Compare models", hidden: true },
      ]),
    }),
  );

  renderHeader(TITLE, DESCRIPTION);

  const available = tasks.map((task) => task.id).sort();
  const metrics = toTaskMetrics(tasks);

  // `{ suite: [taskId] }` — which suites there is a control for, and which of them a pin
  // belongs to.
  const bySuite = new Map();

  for (const taskId of available) {
    const suite = suiteFromTask(taskId);

    if (suite) bySuite.set(suite, [...(bySuite.get(suite) ?? []), taskId]);
  }

  // A row is one model, and the model is what the table is indexed by — so a tick and a pick
  // are the same key, and the comparison's own cache key is that key too. The rest is what it
  // shows before its fetch lands.
  function toModelEntry(row) {
    return {
      key: row.modelId,
      modelId: row.modelId,
      name: row.model_name,
      teamName: row.team_name,
    };
  }

  // The entries a row's scores came from, so a breakdown describes what the board ranked
  // rather than whatever is newest by the time it is asked — a filtered board stands on the
  // newest *matching* entry, which is not always the newest.
  function toBreakdownEntry(row) {
    return {
      ...toModelEntry(row),
      taskSubmissionIds: Object.values(row.scores ?? {}).map(
        (score) => score.task_submission_id,
      ),
    };
  }

  // The board's own scores, so a comparison and the rows it was picked from cannot disagree:
  // already the newest entry per task that matches the applied filters, and already
  // public-only. Looked up on every render rather than carried on the entry — Apply refetches
  // the board under the picks, and the selection keeps the entry object it already holds.
  function scoresOf(entry) {
    return scoresByModel.get(String(entry.modelId)) ?? null;
  }

  let mode = BREAKDOWN;

  // Built on first use and kept: each holds its picks and whatever it has already fetched,
  // and the board underneath is rebuilt on every change.
  const panels = new Map();

  function ensurePanel(name) {
    const held = panels.get(name);

    if (held) return held;

    const panel =
      name === COMPARE
        ? {
            controller: createModelComparison({
              container: getSectionBody(COMPARE_SECTION),
              toEntry: toModelEntry,
              scoresOf,
            }),
            binding: {},
          }
        : {
            controller: createModelBreakdown({
              container: getSectionBody(BREAKDOWN_SECTION),
              toEntry: toBreakdownEntry,
            }),
            // One row at a time, replaced rather than refused on the next click; and the
            // model name still goes to the model's own page, since a click elsewhere on the
            // row is what opens this.
            binding: { claimLinks: false, rolling: true },
          };

    panel.picking = bindTableSelection(panel.controller, panel.binding);

    panels.set(name, panel);

    return panel;
  }

  function showMode() {
    getSection(BREAKDOWN_SECTION).hidden = mode !== BREAKDOWN;
    getSection(COMPARE_SECTION).hidden = mode !== COMPARE;
  }

  // What a re-filtered board does to the picks under it, which differs by panel because the
  // scores behind them are reached differently.
  //
  // The comparison reads its scores through `scoresOf` on every render, so a survivor
  // corrects itself and only a model that has left the board has to go — it would otherwise
  // sit there as a model that scored nothing.
  //
  // The breakdown asks the server about the ids frozen on its entry, which nothing can
  // correct in place, so it is cleared outright: the entries it was describing are the ones
  // the filter just replaced.
  //
  // Only on a board that arrived. A failed refetch knows nothing about the field, and acting
  // on it would lose the reader's picks to a network error.
  function settlePicks() {
    if (!standings) return;

    const comparison = panels.get(COMPARE)?.controller;

    for (const key of comparison?.keys() ?? []) {
      if (!scoresByModel.has(String(key))) comparison.drop(key);
    }

    panels.get(BREAKDOWN)?.controller.clear();
  }

  let chosen = readTasks(available);

  // What the board on screen was fetched with, as against what the controls currently say —
  // the difference is what the Apply button is for.
  let applied = readFilters();
  let standings = null;

  // model id => its scores, off the board in hand. Rebuilt with `standings`, which is the
  // only thing that moves them: the task choice picks which tasks are *ranked*, and a row
  // carries every score either way.
  let scoresByModel = new Map();

  // Replacing the section's contents detaches a Tabulator's element but doesn't free it: its
  // own registry keeps the instance and its ResizeObserver alive, one orphan per redraw.
  let table = null;

  function renderBoard() {
    const body = getSectionBody(BOARD_SECTION);

    // Detached before it is destroyed: a binding holds the instance and subscribes to its
    // controller, so a disposed table left attached would be reconciled against on the next
    // pick — see destroyTable in templates/listView.js. Every panel, not just the shown one:
    // the other is still subscribed from when it last had the board.
    for (const panel of panels.values()) panel.picking.attach(null);

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

    // Selection behaviour is fixed when a Tabulator is created, which is why switching
    // panels rebuilds the board rather than reconfiguring it.
    const panel = ensurePanel(mode);

    const mounted = createLeaderboardTable({
      rows,
      taskIds: chosen,
      metrics,
      selection: panel.picking.selection(),
    });

    body.replaceChildren(mounted.element);
    table = mounted.table;

    // Attached after the build, so the ticks already in the panel are put back on the rows
    // that carry them — a board rebuilt by a task change keeps its picks.
    panel.picking.attach(table);
  }

  // The lists are written once and read back on every change: the boxes are the state, so
  // the only thing a render owes them is the suites the task choice adds up to.
  function renderLists() {
    renderHtml(
      getSectionBody(TASKS_SECTION),
      buildLists(available, chosen, bySuite),
      { refresh: true },
    );
  }

  // The controls hold the pending values while `applied` holds the fetched ones, so this is
  // written with whatever they should now say: what the board was fetched with at first, and
  // the defaults when Clear puts them back. `refresh` because the chips carry a ✕.
  function renderFilters(filters) {
    renderHtml(getSectionBody(FILTERS_SECTION), buildFilters(filters), {
      refresh: true,
    });
  }

  // What the controls currently say, which is not yet what the board shows.
  function pendingFilters() {
    const root = getSectionBody(FILTERS_SECTION);

    const pending = {};

    for (const { name } of filterLists()) {
      pending[name] = pinnedIn(root, name);
    }

    return pending;
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
    const pending = pendingFilters();
    const empty = emptyFilters();

    const apply = applyButton();
    const clear = clearButton();

    if (apply) apply.disabled = Boolean(standings) && sameFilters(pending, applied);

    if (clear) {
      clear.disabled =
        sameFilters(pending, empty) && sameFilters(applied, empty);
    }
  }

  // What the board now asks for: recorded in the URL so the view can be sent, and fetched.
  // The two go together — a URL naming one field beside a board showing another is the one
  // state this page must never be in — which is the whole reason this is not two calls at
  // each of the buttons.
  function applyFilters(filters) {
    applied = filters;

    writeFilters(applied);

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
      panels.get(COMPARE)?.controller.refresh();

      // Live again only where pressing one would do something: a board that failed to load is
      // worth asking for again with the same filter, one that arrived is not.
      updateFilterButtons();
    });
  }

  function attachEvents() {
    const root = getSectionBody(TASKS_SECTION);

    // A pin in one suite's control is read back off all of them together — what the board is
    // ranked over is every suite's chips. A pin in the suite control above them says which
    // whole suites are wanted, which is applied to the tasks instead.
    function ranked(event) {
      const name = pinFromEvent(event, root, HOOK);

      if (name === SUITE_LIST) {
        chosen = withSuites(chosen, pinnedIn(root, SUITE_LIST), bySuite);
      } else if (bySuite.has(name)) {
        chosen = [...bySuite.keys()].flatMap((suite) => pinnedIn(root, suite));
      } else {
        return;
      }

      // In the order the board reads, not the order they were pinned.
      chosen = available.filter((taskId) => chosen.includes(taskId));

      writeTasks(chosen, available);

      // Rebuilt rather than edited in place: the controls are derived from `chosen`, and a
      // select is closed at rest, so there is no place in a list to lose.
      renderLists();

      renderBoard();
    }

    root.addEventListener("change", ranked);
    root.addEventListener("click", ranked);

    const filters = getSectionBody(FILTERS_SECTION);

    // On the section rather than on each control: the section lives for the life of the page
    // and the controls are rewritten inside it, so delegation is what survives a redraw.
    //
    // Both events go to the same place — a change on a select pins a value, a click on a ✕
    // unpins one — and either leaves both buttons to be judged again. The icon refresh is for
    // the ✕ a new chip brings with it, which lucide has not seen yet.
    function pinned(event) {
      if (!pinFromEvent(event, filters, HOOK)) return;

      refreshIcons();
      updateFilterButtons();
    }

    filters.addEventListener("change", pinned);
    filters.addEventListener("click", pinned);

    // The controls and the board together, so one press is the whole way back to the full
    // field rather than a press and then Apply.
    clearButton()?.addEventListener("click", () => {
      const cleared = emptyFilters();

      // Before the fetch, so what the controls say and what was asked for agree by the time
      // the board lands and the buttons are judged against them.
      renderFilters(cleared);

      applyFilters(cleared);
    });

    // By id rather than delegated: the button is the section's own action, which sits in its
    // header rather than in the body the lists are written into.
    applyButton()?.addEventListener("click", () => {
      applyFilters(pendingFilters());
    });

    getElement(COMPARE_BUTTON_ID)?.addEventListener("click", () => {
      mode = mode === COMPARE ? BREAKDOWN : COMPARE;

      markComparing(mode === COMPARE);
      showMode();

      // The panel being entered opens fresh rather than on whatever it held last time —
      // the same rule as setMode in templates/listView.js.
      ensurePanel(mode).controller.clear();

      renderBoard();
    });
  }

  renderLists();
  renderFilters(applied);
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
