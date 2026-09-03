// Which tasks a board is ranked over: a box per suite, a pinned select of every task, and the
// chips that are the state.
//
// The suites hold nothing — ticking one writes out its tasks, clearing one takes them off —
// so what is chosen is only ever the chips, and a suite ticked whole reads the same as one
// arrived at a task at a time.
//
// The chips are written once and every later change is made in place, so nothing here holds a
// second copy of what is picked.

import { refreshIcons, renderHtml } from "../core/render.js";
import {
  SUITES,
  suiteFromTask,
  suiteLabel,
  taskLabel,
} from "../core/suites.js";
import {
  buildChecks,
  buildPinnedControl,
  buildPins,
  checkFromEvent,
  markChecks,
  pinFromEvent,
  pinIn,
  pinnedIn,
  unpinIn,
} from "../components/filters.js";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const SUITE_CHECK = "suite";
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

// ─── MARKUP ──────────────────────────────────────────────────────────────────

// Short names, which are unique across the suites, and the suite as the class — the list is
// flat, so the chip's colour is the only thing saying which suite a task came from.
function toTaskOptions(taskIds) {
  return taskIds.map((taskId) => ({
    value: taskId,
    label: taskLabel(taskId),
    className: suiteFromTask(taskId),
  }));
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

// The boxes are clear here and ticked by markSuites, off the chips. A chosen task is out of
// the select, which is what pinIn reads to leave an already-chosen one alone.
function buildSelection(available, chosen, bySuite) {
  return `
  <div class="row gap-md left">
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
      className: "inline-select",
      options: toTaskOptions(available),
      selected: chosen,
      placeholder: "Add task",
    })}
    <div data-role="task-pins"></div>
  </div>
  `;
}

// ─── WIDGET ──────────────────────────────────────────────────────────────────

/**
 * The control over which tasks a board is ranked.
 *
 * @param container the element it is rendered into, and the one its listeners are delegated
 *                  to.
 * @param available every task id, in board order.
 * @param onChange  (taskIds) => void, after the choice moved and the URL was rewritten.
 *
 * @returns { taskIds } — what is chosen, in board order.
 */
function createTaskSelection({ container, available, onChange }) {
  const bySuite = toSuites(available);

  let chosen = readTasks(available);

  // Ticked for a suite wholly ranked over, part-way for one some of whose tasks are, clear
  // for none.
  function suiteStates() {
    const states = {};

    for (const [suite, taskIds] of bySuite) {
      const on = taskIds.filter((taskId) => chosen.includes(taskId)).length;

      states[suite] = on === taskIds.length ? "on" : on ? "partial" : null;
    }

    return states;
  }

  function markSuites() {
    markChecks(container, SUITE_CHECK, suiteStates());
  }

  function renderChips() {
    renderHtml(
      container.querySelector(PINS_SLOT),
      buildPins({
        name: TASK_LIST,
        options: toTaskOptions(available),
        selected: chosen,
      }),
      { refresh: true },
    );
  }

  // The box is made true rather than flipped: ticking a part-way one adds what is missing,
  // clearing one takes the whole suite off.
  function checkSuite({ value, on }) {
    let changed = false;

    for (const taskId of bySuite.get(value) ?? []) {
      const moved = on
        ? pinIn(container, TASK_LIST, taskId)
        : unpinIn(container, TASK_LIST, taskId);

      changed = moved || changed;
    }

    return changed;
  }

  // Whether anything actually moved, which is what makes the second of the click and the
  // change harmless.
  function handle(event) {
    const box = checkFromEvent(event);

    const changed = box
      ? box.name === SUITE_CHECK && checkSuite(box)
      : pinFromEvent(event, container) === TASK_LIST;

    if (!changed) return;

    // In the order the board reads, not the order they were pinned.
    chosen = available.filter((taskId) =>
      pinnedIn(container, TASK_LIST).includes(taskId),
    );

    refreshIcons();
    markSuites();

    writeTasks(chosen, available);

    onChange?.(chosen);
  }

  renderHtml(container, buildSelection(available, chosen, bySuite));

  renderChips();
  markSuites();

  container.addEventListener("change", handle);
  container.addEventListener("click", handle);

  return { taskIds: () => [...chosen] };
}

export { createTaskSelection };
