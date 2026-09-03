// Page entry for html/leaderboard/leaderboard.html.
//
// Fetch the board, map it once, then hand the rows to the table. The rows and the ranking
// over them are utils/leaderboardUtils.js and the columns are tables/leaderboardTable.js;
// what this page owns is which tasks the board is ranked over.
//
// Under the board is the model comparison, and only that: a row is a pick from the moment the
// page loads, so there is no mode to enter and nothing to switch between — see
// comparisons/recordComparison.js for the three panels behind its tabs.
//
// Two controls above it, and only one of them decides anything: the tasks. The suites are a
// shortcut into that list — ticking a box writes out its tasks, clearing it takes them off —
// because a reader almost always wants whole suites and occasionally wants part of one.
// Re-ranking needs no request: the server sends a rank per task and ranking a model within a
// task doesn't depend on which other tasks are on screen, so the mean is recomputed here.
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
  buildChecks,
  buildPinnedControl,
  buildPinnedSelect,
  buildPins,
  checkFromEvent,
  markChecks,
  pinFromEvent,
  pinIn,
  pinnedIn,
  unpinIn,
} from "../components/filters.js";
import {
  buildRange,
  markRange,
  rangeFromEvent,
  rangeIn,
} from "../components/ranges.js";
import { formatCount } from "../core/utils.js";
import { buildButton, setButtonLabel } from "../components/buttons.js";
import { getIcon } from "../components/icons.js";
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
const COMPARE_SECTION = "board-compare";

// The lists are found by `data-role`, not by the bar's `data-filter`: neither narrows rows,
// and a delegated listener must never mistake one for a filter control.
// Two controls beside the section's heading. The suites are boxes rather than a value: they
// hold nothing, and ticking one writes out that suite's tasks while clearing one takes them
// off. The task list is the state — its chips are what the board is ranked over.
const SUITE_CHECK = "suite";
const TASK_LIST = "task";
const PRETRAINED = "pretrained";
const HOOK = "role";

const APPLY_ID = "apply-filters";
const CLEAR_ID = "clear-filters";
const MORE_ID = "more-filters";

// The two halves of the filter row, as containers rather than as markup: they are what the
// lists are written into, so the three buttons on the row beside them are built once and keep
// their listeners while the controls are rewritten.
//
// The second is shown and hidden rather than built and dropped, so what a reader has pinned in
// it survives being folded away — and is still what Apply asks for.
const LEAD_LISTS_ID = "lead-filter-lists";
const MORE_LISTS_ID = "more-filter-lists";

const MORE_LABEL = "Show more filters";
const FEWER_LABEL = "Show fewer filters";

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

// What the model itself is: the three shown at rest, beside the heading. What a reader
// narrowing a board asks first, and few enough to fit on the row.
function modelFilterLists() {
  return [
    { name: PRETRAINED, label: "Pretrained", options: PRETRAINED_OPTIONS },
    ...MODEL_KEYS.map((key) => ({
      name: key,
      label: MODEL_FIELDS[key].label,
      options: MODEL_FIELDS[key].options ?? [],
    })),
  ];
}

// The two things about a model that are a number rather than a choice. Bounds rather than
// values, and their own descriptors rather than a schema's: what a reader narrows by here is a
// span, and the span is this page's to state — the schema says the field exists and nothing
// about what range of it is worth offering.
//
// The parameter count is logarithmic. It runs from a thousand to two hundred billion, and on a
// linear track every step is either invisible at the bottom or a hundred million at the top;
// on a log one a step is a constant factor, so the thumb moves the way a reader expects
// wherever it is. Which is also why it reads 1.2K and 200B rather than in full.
function rangeFilterLists() {
  return [
    {
      name: "n_parameters",
      label: "Parameters",
      range: { min: 1e3, max: 2e11, scale: "log" },
      format: formatCount,
    },
    {
      name: "temporal_context_s",
      label: "Temporal context",
      range: { min: 0, max: 20, step: 0.5 },
      format: (value) => `${value} s`,
    },
  ];
}

// How each task was produced: the five behind "Show more filters". The second question, and
// the one a reader only sometimes has — five more controls on the row at rest would bury the
// three that answer the first.
function taskFilterLists() {
  return METHODOLOGY_KEYS.map((key) => ({
    name: key,
    label: TASK_FIELDS[key].label,
    options: TASK_FIELDS[key].options ?? [],
  }));
}

// Every filter the board can be narrowed by, in the order they are drawn: the model's own
// three, then its two spans, then how each task was produced. Read, built and read back from
// this one list, so the three can't fall out of step — which half a filter is in is a matter of
// where it is drawn, and nothing else here knows the difference.
//
// A descriptor carrying `range` is a pair of bounds where the rest are sets of values. That is
// the one difference every step below has to keep in mind: what is read from the URL, what is
// written back, what an empty one is, and what control is built for it.
//
// Options come from the server's own enums, filled into both schemas in place — see
// loadModelMeta and loadTaskFields.
function filterLists() {
  return [...modelFilterLists(), ...rangeFilterLists(), ...taskFilterLists()];
}

// The ones behind the fold: the spans and the methodology. Everything that is not one of the
// three the section opens with.
function foldedFilterLists() {
  return [...rangeFilterLists(), ...taskFilterLists()];
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

// A span in the URL: the two bounds the endpoint takes, under the names it takes them by.
//
// Both halves or neither. A pair with one bound missing is a state the control cannot be in —
// its thumbs are always somewhere — so a link carrying half of one is a link to distrust, and
// this reads it as no filter rather than guessing which end was meant.
//
// Read as numbers and checked against the span the page offers, the same rule the value lists
// follow: a stale link cannot ask for a bound the control has no thumb position for.
function readRange(params, { name, range }) {
  const written = [params.get(`${name}_min`), params.get(`${name}_max`)];

  // Whether they are *there*, before what they say: an absent parameter is `null` and an empty
  // one is "", and `Number` reads both as 0 — which is a bound the temporal span has a thumb
  // position for, so a bare URL would otherwise ask for "between 0 and 0".
  if (written.some((value) => value == null || value === "")) return null;

  const [from, to] = written.map(Number);

  const known = (value) =>
    Number.isFinite(value) && value >= range.min && value <= range.max;

  if (!known(from) || !known(to) || from > to) return null;

  return { min: from, max: to };
}

// Every filter the board can be narrowed by, as one object: a list of values per choice and a
// pair of bounds per span. Kept together because they are applied together — one button, one
// request, one set of ranks.
function readFilters() {
  const params = new URLSearchParams(location.search);
  const filters = {};

  for (const list of filterLists()) {
    if (list.range) {
      filters[list.name] = readRange(params, list);

      continue;
    }

    const known = list.options.map((option) => option.value);

    // Checked against what the schema offers, so a stale link can't tick a box that no longer
    // exists — or a value the server would refuse.
    filters[list.name] = (params.get(list.name) ?? "")
      .split(",")
      .filter((value) => known.includes(value));
  }

  return filters;
}

// replaceState, not pushState: working a filter shouldn't build a stack of history entries to
// press Back through. The URL still survives a refresh and can still be sent.
//
// A span writes the two parameters the endpoint reads and drops both together, so the URL is
// never in the half state readRange refuses.
function writeFilters(filters) {
  const url = new URL(location.href);

  for (const [key, value] of Object.entries(filters)) {
    if (isRange(value) || filters[key] === null) {
      const range = isRange(value) ? value : null;

      for (const [suffix, bound] of [
        ["min", range?.min],
        ["max", range?.max],
      ]) {
        if (bound == null) url.searchParams.delete(`${key}_${suffix}`);
        else url.searchParams.set(`${key}_${suffix}`, String(bound));
      }

      continue;
    }

    const asked = Array.isArray(value) ? value.join(",") : value;

    if (asked) url.searchParams.set(key, asked);
    else url.searchParams.delete(key);
  }

  history.replaceState(null, "", url);
}

// Whether a filter's value is a pair of bounds rather than a set of values — which is the one
// thing the four functions around it have to tell apart. Off the value, since that is what
// each of them is handed.
function isRange(value) {
  return Boolean(value) && !Array.isArray(value) && typeof value === "object";
}

// Every filter at rest: no values and no bounds, which is what the endpoint reads as no filter
// and what a bare URL produces. What Clear puts the controls back to.
function emptyFilters() {
  return Object.fromEntries(
    filterLists().map(({ name, range }) => [name, range ? null : []]),
  );
}

// What one filter is asking for, as one string — so two of them can be compared whichever
// shape they are.
function asked(value) {
  if (isRange(value)) return `${value.min}-${value.max}`;

  return Array.isArray(value) ? value.join(",") : String(value ?? "");
}

// Whether two sets of filters would ask the same question, which is what decides whether the
// Apply button has anything to do.
function sameFilters(left, right) {
  return Object.keys(left).every((key) => asked(left[key]) === asked(right[key]));
}

// ─── LISTS ───────────────────────────────────────────────────────────────────

// Every task as one option, in board order. Short names, which are unique across the suites
// — see taskLabel — so the list reads without a suite heading over every few lines.
//
// The class is the suite, which is what colours the chip a task is pinned as: the list is
// flat and the names carry no prefix, so the colour is the only thing saying which suite a
// chip came from.
function toTaskOptions(taskIds) {
  return taskIds.map((taskId) => ({
    value: taskId,
    label: taskLabel(taskId),
    className: suiteFromTask(taskId),
  }));
}

// The two controls, on the heading's own row: a box per suite beside its own badge, then the
// task list after them. Only the suites that have a task, so a box can't stand for nothing.
//
// No row of its own around them — the section's controls slot is the row, and both halves of
// buildLeadFilters go into the same one below.
//
// The boxes are clear here and ticked by markSuites, off the chips — one path to what is on,
// so a suite ticked whole and a suite added task by task read the same.
function buildControls(available, taskIds, bySuite) {
  return `
    ${buildChecks({
      name: SUITE_CHECK,
      options: SUITES.filter((suite) => bySuite.has(suite)).map((suite) => ({
        value: suite,
        label: suiteLabel(suite),
        className: suite,
      })),
    })}
    ${buildPinnedControl({
      name: TASK_LIST,
      hook: HOOK,
      className: "inline-select",
      options: toTaskOptions(available),
      selected: taskIds,
      placeholder: "Add task",
    })}`;
}

// ─── FILTERS ─────────────────────────────────────────────────────────────────

// The filters, in two halves. Applied on a button rather than on the dropdowns, because
// narrowing the field is a request: the ranks come back computed over whatever survives, so a
// change here is a new board rather than a redraw of this one.
//
// Which is also why the controls above apply themselves — those need no request, and a
// control that waits when it doesn't have to is a control that reads as broken.
//
// Every one narrows by *any of* what is pinned: "supervised or self-supervised" is a question
// a reader has, and "supervised" is the same question with one chip.
//
// A pinned select rather than a list of boxes: eight fields of up to five options each is
// forty boxes on screen before the reader has asked for anything, where these are eight closed
// selects that grow only where something is picked.

// The section's own layout, written once: the three at rest on a row with the three buttons,
// and the other five folded away under them.
//
// The buttons are here rather than in the section's header because they belong to the row —
// the fold is what the two containers beside them do, and Clear and Apply are what the whole
// row adds up to. Built once and never rewritten, so each is still found by its id after the
// lists beside it have been replaced.
//
// `align-start` so the buttons sit level with the labels rather than floating half-way down a
// column that has grown chips.
function buildFilterShell() {
  return `
    <div class="row align-start">
      <div class="row left gap-lg" id="${LEAD_LISTS_ID}"></div>
      <div class="row right gap-md">
        ${buildButton({
          id: MORE_ID,
          label: MORE_LABEL,
          icon: getIcon("expand"),
        })}
        ${buildButton({
          id: CLEAR_ID,
          label: "Clear filters",
          icon: getIcon("cancel"),
          // Nothing to clear until a control holds something.
          disabled: true,
        })}
        ${buildButton({
          id: APPLY_ID,
          label: "Apply filters",
          icon: getIcon("filter"),
          // Nothing to apply until a control differs from what the board was fetched with.
          disabled: true,
        })}
      </div>
    </div>
    <div class="grid-3" id="${MORE_LISTS_ID}" hidden></div>`;
}

// One half's filters, for the container they go in. Each is its own column — the field name
// over the control, whatever the control needs under it — so a filter reads top to bottom
// whichever half it is in, and the two halves differ only in how wide a select is allowed to
// be.
//
// `inline-select` for the three on the row, which have to leave room for the buttons beside
// them; nothing for the ones in the grid, whose cell is already a third of the section. A span
// takes the width it is given either way: a track has no natural size to leave alone.
function buildFilterLists(lists, filters, className = "") {
  return lists
    .map((list) =>
      list.range
        ? buildRange({
            name: list.name,
            label: list.label,
            ...list.range,
            value: filters[list.name],
          })
        : buildPinnedSelect({
            name: list.name,
            hook: HOOK,
            className,
            label: list.label,
            options: list.options,
            selected: filters[list.name],
          }),
    )
    .join("");
}

// ─── PAGE ────────────────────────────────────────────────────────────────────

function renderLeaderboardPage({ tasks, myTeamIds }) {
  const available = tasks.map((task) => task.id).sort();
  const metrics = toTaskMetrics(tasks);

  // `{ suite: [taskId] }` — which suites there is something to add, and what adding one means.
  const bySuite = new Map();

  for (const taskId of available) {
    const suite = suiteFromTask(taskId);

    if (suite) bySuite.set(suite, [...(bySuite.get(suite) ?? []), taskId]);
  }

  // What the board is ranked over. Read before the page is written, because the two controls
  // sit beside the section's heading rather than in its body — a header is built with its
  // section rather than rendered into afterwards.
  let chosen = readTasks(available);

  renderPage(
    buildPage({
      header: buildHeader(),
      body: buildSections([
        {
          id: TASKS_SECTION,
          title: "Ranked over",
          controls: buildControls(available, chosen, bySuite),
        },
        // Title only: the whole of this one — the controls, the fold and the two buttons —
        // is one row inside it, written by buildFilterShell. A column body, so the five that
        // unfold are not flush against the row they unfold from.
        {
          id: FILTERS_SECTION,
          title: "Filters",
          className: "column gap-md",
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

  // What the board on screen was fetched with, as against what the controls currently say —
  // the difference is what the Apply button is for.
  let applied = readFilters();
  let standings = null;

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

  // Which suites the chips add up to: ticked for a suite wholly ranked over, part-way for one
  // some of whose tasks are, clear for none. Read off `chosen` rather than held, so a suite
  // ticked whole and a suite arrived at one task at a time cannot look different.
  function suiteStates() {
    const states = {};

    for (const [suite, taskIds] of bySuite) {
      const on = taskIds.filter((taskId) => chosen.includes(taskId)).length;

      states[suite] = on === taskIds.length ? "on" : on ? "partial" : null;
    }

    return states;
  }

  function markSuites() {
    markChecks(getSection(TASKS_SECTION), SUITE_CHECK, suiteStates());
  }

  // The chips, in the body under the controls that head the section. Written once: they are
  // the state, and every change to them is made in place by pinFromEvent or pinIn — which is
  // also why the controls above can live in a header nothing renders into twice.
  function renderChips() {
    renderHtml(
      getSectionBody(TASKS_SECTION),
      buildPins({
        name: TASK_LIST,
        options: toTaskOptions(available),
        selected: chosen,
      }),
      { refresh: true },
    );
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

  // The controls hold the pending values while `applied` holds the fetched ones, so this is
  // written with whatever they should now say: what the board was fetched with at first, and
  // the defaults when Clear puts them back. `refresh` because the chips carry a ✕.
  //
  // Both halves in one call, because they are one set of values — a Clear that put back only
  // the half in view would leave the other still narrowing the board. Into the containers
  // rather than over the row, so the three buttons on it are left alone.
  function renderFilters(filters) {
    renderHtml(
      getElement(LEAD_LISTS_ID),
      buildFilterLists(modelFilterLists(), filters, "inline-select"),
      { refresh: true },
    );

    renderHtml(
      getElement(MORE_LISTS_ID),
      buildFilterLists(foldedFilterLists(), filters),
      { refresh: true },
    );

    markRanges();
  }

  // How a span's bounds are written, off its own descriptor: a parameter count reads 200B and
  // a window reads 2.5 s, and neither is something the widget could know.
  function formatOf(name) {
    return filterLists().find((list) => list.name === name)?.format;
  }

  // What each span reads as, and the band between its thumbs. After every render, because the
  // markup carries the thumbs' positions and nothing else — see markRange.
  function markRanges() {
    const root = getSectionBody(FILTERS_SECTION);

    for (const { name, range } of filterLists()) {
      if (range) markRange(root, name, formatOf(name));
    }
  }

  // What the controls currently say, which is not yet what the board shows. A span reads back
  // as null while its thumbs are at both ends, which is the same answer an unticked select
  // gives: nothing to narrow by.
  function pendingFilters() {
    const root = getSectionBody(FILTERS_SECTION);

    const pending = {};

    for (const { name, range } of filterLists()) {
      pending[name] = range ? rangeIn(root, name) : pinnedIn(root, name);
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
      comparison.refresh();

      // Live again only where pressing one would do something: a board that failed to load is
      // worth asking for again with the same filter, one that arrived is not.
      updateFilterButtons();
    });
  }

  function attachEvents() {
    // The section, not its body: the two controls head it and the chips sit inside, and both
    // halves have to be under whatever the listener is delegated to — see pinFromEvent.
    const root = getSection(TASKS_SECTION);

    // A box writes out or takes off its own tasks, so a suite is a way of naming several
    // rather than a thing that is held: what the board is ranked over is only ever the task
    // chips. The box is made true rather than flipped — ticking a part-way one adds what is
    // missing and leaves the tasks already chosen where they are, and clearing one takes the
    // whole suite off.
    function checkSuite({ value, on }) {
      let changed = false;

      for (const taskId of bySuite.get(value) ?? []) {
        const moved = on
          ? pinIn(root, TASK_LIST, taskId, HOOK)
          : unpinIn(root, TASK_LIST, taskId, HOOK);

        changed = moved || changed;
      }

      // Whether anything actually moved: a suite already in the state the box asks for is a
      // no-op, which is also what makes the second of the click and the change harmless.
      return changed;
    }

    function ranked(event) {
      const box = checkFromEvent(event);

      const changed = box
        ? box.name === SUITE_CHECK && checkSuite(box)
        : pinFromEvent(event, root, HOOK) === TASK_LIST;

      if (!changed) return;

      // In the order the board reads, not the order they were pinned.
      chosen = available.filter((taskId) =>
        pinnedIn(root, TASK_LIST).includes(taskId),
      );

      refreshIcons();
      markSuites();

      writeTasks(chosen, available);

      // Before the board is rebuilt, so it is mounted against the picks that survived the new
      // choice rather than against the ones that made it — the same order loadBoard uses.
      dropDepartedPicks();

      renderBoard();

      // The panel is drawn over the same tasks, so a change here is a change to its axis —
      // see scoresOf. No fetch: the ranks move, the scores behind them do not. Called whether
      // or not anything was dropped, since a pick that survived is still drawn over fewer
      // tasks than before.
      comparison.refresh();
    }

    root.addEventListener("change", ranked);
    root.addEventListener("click", ranked);

    const filters = getSectionBody(FILTERS_SECTION);

    // On the section's body rather than on each control: the body lives for the life of the
    // page and the two halves are rewritten inside it, so delegation is what survives a
    // redraw.
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

    // `input` rather than `change`, and a listener of its own: a thumb reports continuously
    // while it is dragged and the readout is the only thing saying where the reader is, but a
    // select fires both — so reading the pins here too would read each pick twice.
    filters.addEventListener("input", (event) => {
      const range = rangeFromEvent(event);

      if (!range) return;

      markRange(filters, range.name, formatOf(range.name));
      updateFilterButtons();
    });

    // By id like the two beside it: the shell it sits in is written once, and only the
    // containers either side of it are rewritten.
    getElement(MORE_ID)?.addEventListener("click", () => {
      showingMore = !showingMore;

      renderMore();
    });

    // The controls and the board together, so one press is the whole way back to the full
    // field rather than a press and then Apply.
    clearButton()?.addEventListener("click", () => {
      const cleared = emptyFilters();

      // Before the fetch, so what the controls say and what was asked for agree by the time
      // the board lands and the buttons are judged against them.
      renderFilters(cleared);

      applyFilters(cleared);
    });

    applyButton()?.addEventListener("click", () => {
      applyFilters(pendingFilters());
    });
  }

  renderChips();
  markSuites();

  // The shell before the lists it holds, and before attachEvents, which finds the three
  // buttons on its row by id.
  renderHtml(getSectionBody(FILTERS_SECTION), buildFilterShell());

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
