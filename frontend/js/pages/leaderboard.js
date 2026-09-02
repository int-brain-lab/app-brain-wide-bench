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
import { getElement, renderHtml } from "../core/render.js";
import { SUITES, suiteFromTask, suiteLabel } from "../core/suites.js";
import {
  buildEmptyMessage,
  buildFailureMessage,
  buildInfoMessage,
} from "../components/messages.js";
import {
  buildCheckList,
  checkedIn,
  setCheckedIn,
} from "../components/filters.js";
import {
  COMPARE_BUTTON_ID,
  buildButton,
  buildCompareButton,
} from "../components/buttons.js";
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
const SUITE_LIST = "suite";
const TASK_LIST = "task";
const PRETRAINED = "pretrained";
const HOOK = "role";

const APPLY_ID = "apply-filters";

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

// Grouped by suite and in SUITES order, so the list reads the way every other suite list in
// the app does. The label drops the suite prefix, which the group heading carries instead.
function toTaskGroups(taskIds) {
  return SUITES.map((suite) => ({
    label: suiteLabel(suite),
    options: taskIds
      .filter((taskId) => suiteFromTask(taskId) === suite)
      .map((taskId) => ({
        value: taskId,
        label: taskId.slice(taskId.indexOf("-") + 1),
      })),
  })).filter((group) => group.options.length);
}

// A suite is ticked where every one of its tasks is: a partly-chosen suite is not chosen,
// because ticking it is what chooses all of them.
function suitesOf(taskIds, bySuite) {
  return [...bySuite.keys()].filter((suite) =>
    bySuite.get(suite).every((taskId) => taskIds.includes(taskId)),
  );
}

function buildLists(available, taskIds, bySuite) {
  return `
    <div class="column gap-md">
      ${buildCheckList({
        name: SUITE_LIST,
        hook: HOOK,
        options: SUITES.filter((suite) => bySuite.has(suite)).map((suite) => ({
          value: suite,
          label: suiteLabel(suite),
        })),
        selected: suitesOf(taskIds, bySuite),
      })}
      ${buildCheckList({
        name: TASK_LIST,
        hook: HOOK,
        options: toTaskGroups(available),
        selected: taskIds,
        columns: 3,
      })}
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
// Which is also why the task lists above apply themselves — those need no request, and a
// control that waits when it doesn't have to is a control that reads as broken.
// One list per thing that can be narrowed, headed by its own label — the model's own flag
// first, then how each task was produced. `buildCheckList`'s grouped form does the heading, so
// a field is one call rather than a wrapper around one.
//
// Every list narrows by *any of* what is ticked: "supervised or self-supervised" is a question
// a reader has, and "supervised" is the same question with one box.
function buildFilters(filters) {
  // Three across, which puts the model's own three on the first row and the task's five under
  // them — the grouping is the order rather than a heading over each half.
  return `
    <div class="grid-3">
      ${filterLists()
        .map(({ name, label, options }) =>
          buildCheckList({
            name,
            hook: HOOK,
            options: [{ label, options }],
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
        { id: COMPARE_SECTION, title: "Compare models", hidden: true },
      ]),
    }),
  );

  renderHeader(TITLE, DESCRIPTION);

  const available = tasks.map((task) => task.id).sort();
  const metrics = toTaskMetrics(tasks);

  // `{ suite: [taskId] }`, for the suite list and for what ticking one means.
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

  let comparing = false;

  // Built on the first compare and kept: it holds the picks and whatever it has already
  // fetched, and the board underneath is rebuilt on every change.
  let comparison = null;
  let picking = null;

  function ensureComparison() {
    if (comparison) return picking;

    comparison = createModelComparison({
      container: getSectionBody(COMPARE_SECTION),
      toEntry: toModelEntry,
    });

    picking = bindTableSelection(comparison);

    return picking;
  }

  let chosen = readTasks(available);

  // What the board on screen was fetched with, as against what the controls currently say —
  // the difference is what the Apply button is for.
  let applied = readFilters();
  let standings = null;

  // Replacing the section's contents detaches a Tabulator's element but doesn't free it: its
  // own registry keeps the instance and its ResizeObserver alive, one orphan per redraw.
  let table = null;

  function renderBoard() {
    const body = getSectionBody(BOARD_SECTION);

    // Detached before it is destroyed: the binding holds the instance and subscribes to the
    // comparison, so a disposed table left attached would be reconciled against on the next
    // pick — see destroyTable in templates/listView.js.
    picking?.attach(null);

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

    // Selection behaviour is fixed when a Tabulator is created, which is why entering or
    // leaving compare mode rebuilds the board rather than reconfiguring it.
    const binding = comparing ? ensureComparison() : null;

    const mounted = createLeaderboardTable({
      rows,
      taskIds: chosen,
      metrics,
      selection: binding?.selection() ?? null,
    });

    body.replaceChildren(mounted.element);
    table = mounted.table;

    // Attached after the build, so the ticks already in the comparison are put back on the
    // rows that carry them — a board rebuilt by a task change keeps its picks.
    picking?.attach(comparing ? table : null);
  }

  // The lists are written once and read back on every change: the boxes are the state, so
  // the only thing a render owes them is the suites the task choice adds up to.
  function renderLists() {
    renderHtml(
      getSectionBody(TASKS_SECTION),
      buildLists(available, chosen, bySuite),
    );
  }

  // Written once too, and thereafter the controls hold the pending values while `applied`
  // holds the fetched ones. `refresh` because the button carries an icon.
  function renderFilters() {
    renderHtml(getSectionBody(FILTERS_SECTION), buildFilters(applied), {
      refresh: true,
    });
  }

  // What the controls currently say, which is not yet what the board shows.
  function pendingFilters() {
    const root = getSectionBody(FILTERS_SECTION);

    const pending = {};

    for (const { name } of filterLists()) {
      pending[name] = checkedIn(root, name, HOOK);
    }

    return pending;
  }

  function applyButton() {
    return getElement(APPLY_ID);
  }

  // The board is fetched, not redrawn: the ranks are computed over whatever survives the
  // filter, so a narrowed field is a different set of numbers.
  function loadBoard() {
    const button = applyButton();

    if (button) button.disabled = true;

    renderHtml(
      getSectionBody(BOARD_SECTION),
      buildInfoMessage("Loading the board…"),
    );

    return getLeaderboard(applied).then((loaded) => {
      standings = loaded;
      renderBoard();

      // Live again only where pressing it would do something: a board that failed to load is
      // worth asking for again with the same filter, one that arrived is not.
      const after = applyButton();

      if (after) {
        after.disabled = Boolean(standings) && sameFilters(pendingFilters(), applied);
      }
    });
  }

  function attachEvents() {
    const root = getSectionBody(TASKS_SECTION);

    root.addEventListener("change", (event) => {
      const box = event.target;

      if (box.dataset?.[HOOK] === SUITE_LIST) {
        // A suite ticks or unticks its own tasks, leaving the others alone: a reader adding
        // TS2 to a part-chosen TS1 means "and TS2", not "only TS2".
        const own = bySuite.get(box.value) ?? [];

        chosen = box.checked
          ? [...chosen, ...own.filter((taskId) => !chosen.includes(taskId))]
          : chosen.filter((taskId) => !own.includes(taskId));

        setCheckedIn(root, TASK_LIST, chosen, HOOK);
      } else if (box.dataset?.[HOOK] === TASK_LIST) {
        chosen = checkedIn(root, TASK_LIST, HOOK);

        // The suites follow the tasks rather than the other way about, so unticking one task
        // of a suite unticks the suite without touching the rest.
        setCheckedIn(root, SUITE_LIST, suitesOf(chosen, bySuite), HOOK);
      } else {
        return;
      }

      // In the order the board reads, not the order they were ticked.
      chosen = available.filter((taskId) => chosen.includes(taskId));

      writeTasks(chosen, available);
      renderBoard();
    });

    const filters = getSectionBody(FILTERS_SECTION);

    // On the section rather than on the select: both live for the life of the page, so either
    // would do, and the section is what a future filter would be added under.
    filters.addEventListener("change", () => {
      const button = applyButton();

      if (button) button.disabled = sameFilters(pendingFilters(), applied);
    });

    // By id rather than delegated: the button is the section's own action, which sits in its
    // header rather than in the body the lists are written into.
    applyButton()?.addEventListener("click", () => {
      applied = pendingFilters();

      writeFilters(applied);
      loadBoard();
    });

    getElement(COMPARE_BUTTON_ID)?.addEventListener("click", () => {
      comparing = !comparing;

      markComparing(comparing);
      getSection(COMPARE_SECTION).hidden = !comparing;

      renderBoard();
    });
  }

  renderLists();
  renderFilters();
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
