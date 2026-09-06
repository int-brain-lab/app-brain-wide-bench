// Which tasks a board is ranked over: a badge per suite in one column, the chips that are the
// state in the next, and the select that adds one above them.
//
// The suites hold nothing — ticking one writes out its tasks, clearing one takes them off —
// so what is chosen is only ever the chips, and a suite ticked whole reads the same as one
// arrived at a task at a time.
//
// The chips are written once and every later change is made in place, so nothing here holds a
// second copy of what is picked.

import { escapeHtml } from "../core/html.js";
import { refreshIcons, renderHtml } from "../core/render.js";
import {
  SUITES,
  suiteFromTask,
  suiteLabel,
  taskLabel,
} from "../core/suites.js";
import {
  buildPinnedControl,
  buildPins,
  pinFromEvent,
  pinIn,
  pinnedIn,
  unpinIn,
} from "../components/filters.js";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const SUITE_BADGES = "suite";
const TASK_LIST = "task";

const PINS_SLOT = "[data-role='task-pins']";

// What a shareable board is ranked over. The suites are not in it — they are a way of ticking
// tasks, and the tasks say what was ticked.
const TASKS_PARAM = "tasks";

// ─── URL ─────────────────────────────────────────────────────────────────────

// Every task by default: the board opens on the whole benchmark.
function readTasks(available) {
  const asked = (
    new URLSearchParams(location.search).get(TASKS_PARAM) ?? ""
  ).split(",");

  const known = asked.filter((taskId) => available.includes(taskId));

  return known.length ? known : available;
}

// Nothing in the URL for the default, so a shared link is the short one until the reader has
// chosen something.
function writeTasks(taskIds, available) {
  const url = new URL(location.href);

  if (taskIds.length === available.length) url.searchParams.delete(TASKS_PARAM);
  else url.searchParams.set(TASKS_PARAM, taskIds.join(","));

  history.replaceState(null, "", url);
}

// ─── BADGES ──────────────────────────────────────────────────────────────────
//
// A badge per value, pressed to take everything it stands for on or off: the control for a
// handful of values with a colour of their own, where a select would hide behind a
// placeholder what a badge says outright.
//
// Three states, because one badge stands for several tasks and can be part-way there: on,
// `partial` for some of them, and clear. Partial is only ever set from outside — a press on
// one goes to on, which is what "add the rest" should do.
//
// No state of its own: what is set is updateBadges' to say, off the chips, so a badge stands
// for something it does not store.

// The row's name, on every badge in it.
const BADGE = "badge";

/**
 * One row of them, all clear — call updateBadges to set them.
 *
 * @param name    what a listener finds them by, on every badge in the row.
 * @param options [{ value, label, className }]. The class is the badge's own modifier, so a
 *                value with a colour keeps it here.
 * @returns the markup.
 */
function buildBadges({ name, options }) {
  return `
    <span class="row left gap-sm">
      ${options
        .map(
          (option) => `
        <button
          type="button"
          class="badge toggle ${escapeHtml(option.className ?? "")}"
          data-${BADGE}="${escapeHtml(name)}"
          value="${escapeHtml(option.value)}"
          aria-pressed="false"
        >${escapeHtml(option.label)}</button>`,
        )
        .join("")}
    </span>`;
}

/**
 * Make the badges under `root` say what is chosen.
 *
 * @param root   an ancestor of the row.
 * @param name   the row's, as buildBadges took it.
 * @param states value => "on" | "partial" | anything falsy for clear.
 */
function updateBadges(root, name, states) {
  for (const badge of root.querySelectorAll(`[data-${BADGE}="${name}"]`)) {
    const state = states[badge.value];

    badge.classList.toggle("on", state === "on");
    badge.classList.toggle("partial", state === "partial");

    // "mixed" is what aria has for a control part-way there, which is what `partial` is.
    badge.setAttribute(
      "aria-pressed",
      state === "partial" ? "mixed" : String(state === "on"),
    );
  }
}

/**
 * Which badge was just pressed, and what the press asked for — so a caller can read it as
 * "add these" or "take these off".
 *
 * @returns { name, value, on }, or null for an event that wasn't a badge's. `on` is what the
 *          press has to make true rather than what was there: a part-way badge adds the rest,
 *          and only a full one clears. So acting on it twice is acting on it once.
 */
function badgeFromEvent(event) {
  const badge = event.target?.closest?.(`button[data-${BADGE}]`);

  if (!badge) return null;

  return {
    name: badge.dataset[BADGE],
    value: badge.value,
    on: !badge.classList.contains("on"),
  };
}

// ─── MARKUP ──────────────────────────────────────────────────────────────────

// Short names, which are unique across the suites, under the suite each came from — the list
// is flat, so an option says which suite it is from, and the chip it becomes wears its
// colour.
function toTaskOptions(taskIds) {
  return taskIds.map((taskId) => {
    const suite = suiteFromTask(taskId);

    return {
      value: taskId,
      label: [suiteLabel(suite), taskLabel(taskId)].filter(Boolean).join(" "),
      className: suite,
    };
  });
}

// `{ suite: [taskId] }` — which suites there is something to tick, and what ticking one means.
function toSuites(available) {
  const bySuite = new Map();

  for (const taskId of available) {
    const suite = suiteFromTask(taskId);

    if (suite) bySuite.set(suite, [...(bySuite.get(suite) ?? []), taskId]);
  }

  return bySuite;
}

// Clear here and set by updateSuites, off the chips.
function buildSuites(bySuite) {
  return buildBadges({
    name: SUITE_BADGES,
    options: SUITES.filter((suite) => bySuite.has(suite)).map((suite) => ({
      value: suite,
      label: suiteLabel(suite),
      className: suite,
    })),
  });
}

/**
 * The select that puts one more task in, for a caller placing it beside a section's heading
 * rather than among the chips.
 *
 * Built here rather than by that caller: which tasks there are, in what order, and which are
 * already chosen are this module's to say, and a second reading of the URL could disagree
 * with the chips. A chosen task is out of the select, which is what pinIn reads to leave an
 * already-chosen one alone.
 *
 * Whatever holds it has to sit inside the `root` given to createTaskSelection: the select and
 * the chips are two halves of one control — see pinFromEvent.
 *
 * @param available every task id, in board order.
 * @returns the markup.
 */
function buildTaskSelect(available) {
  return buildPinnedControl({
    name: TASK_LIST,
    className: "task-select",
    options: toTaskOptions(available),
    selected: readTasks(available),
    placeholder: "Add task",
  });
}

// ─── WIDGET ──────────────────────────────────────────────────────────────────

/**
 * The control over which tasks a board is ranked.
 *
 * @param container the element the boxes and the chips are drawn into, as two columns.
 * @param root      an ancestor of both the chips and the select buildTaskSelect made — the
 *                  section, which holds the one beside its heading and the other in its
 *                  body. Listeners are delegated to it, and a pin is looked up inside it.
 *                  Omit where the select sits in `container` itself.
 * @param available every task id, in board order.
 * @param onChange  (taskIds) => void, after the choice moved and the URL was rewritten.
 *
 * @returns { taskIds } — what is chosen, in board order.
 */
function createTaskSelection({
  container,
  root = container,
  available,
  onChange,
}) {
  const bySuite = toSuites(available);

  // What it is for, and the select that adds one, over two columns: the boxes in the narrow
  // one and the chips in the wide one. The chips' span is written empty and filled by
  // renderChips, which is also where every later change is made.
  const html = `
   <div class="column gap-md">
       <div class="column gap-xs">
          <div class="row">
             <span class="card-title">Suites</span>
           </div>
           <div class="metadata bold">Select the suites or a combination of tasks to include in the ranking</div>
       </div>
      <div class="section-row ratio-4">
        <span class="column left gap-ff">
          ${buildSuites(bySuite)}
          ${buildTaskSelect(available)}
        </span>
        <span data-role="task-pins"></span>
      </div>
  </div>
  `
  let chosen = readTasks(available);

  // Ticked for a suite wholly ranked over, part-way for one some of whose tasks are, clear
  // for none.
  function getSuiteStates() {
    const states = {};

    for (const [suite, taskIds] of bySuite) {
      const on = taskIds.filter((taskId) => chosen.includes(taskId)).length;

      states[suite] = on === taskIds.length ? "on" : on ? "partial" : null;
    }

    return states;
  }

  function updateSuites() {
    updateBadges(container, SUITE_BADGES, getSuiteStates());
  }

  function renderChips() {
    renderHtml(
      container.querySelector(PINS_SLOT),
      buildPins({
        name: TASK_LIST,
        options: toTaskOptions(available),
        selected: chosen,
      }),
      {refresh: true},
    );
  }

  // Made true rather than flipped: pressing a part-way badge adds what is missing, and
  // pressing a full one takes the whole suite off.
  function applySuite({value, on}) {
    let changed = false;

    for (const taskId of bySuite.get(value) ?? []) {
      const moved = on
        ? pinIn(root, TASK_LIST, taskId)
        : unpinIn(root, TASK_LIST, taskId);

      changed = moved || changed;
    }

    return changed;
  }

  // Whether anything actually moved, which is what makes the second of the click and the
  // change harmless.
  function handleChoice(event) {
    const badge = badgeFromEvent(event);

    const changed = badge
      ? badge.name === SUITE_BADGES && applySuite(badge)
      : pinFromEvent(event, root) === TASK_LIST;

    if (!changed) return;

    // In the order the board reads, not the order they were pinned.
    chosen = available.filter((taskId) =>
      pinnedIn(root, TASK_LIST).includes(taskId),
    );

    refreshIcons();
    updateSuites();

    writeTasks(chosen, available);

    onChange?.(chosen);
  }

  renderHtml(container, html);

  renderChips();
  updateSuites();

  // The root rather than the container, for a caller whose select sits outside it.
  root.addEventListener("change", handleChoice);
  root.addEventListener("click", handleChoice);

  return {taskIds: () => [...chosen]};
}

export {buildTaskSelect, createTaskSelection};
