// The task panel of the single-page submission form.
//
// Master–detail: detected tasks are listed on the left, grouped by suite, and the
// selected task's methodology form is shown on the right.
//
// The task list is determined entirely by the uploaded zip. This section does not
// add, remove, or rename tasks.
//

import {
  escapeHtml,
  renderMessage,
} from "../utils.js";
import {
  createFieldState,
  revalidateFields,
  setFieldValue,
} from "../components/fields/state.js";
import { renderFields } from "../components/fields/render.js";
import { fieldsForPanel } from "../components/fields/groups.js";
import { getFieldValue, withPreservedFocus } from "../components/fields/events.js";
import {
  TASK_FIELDS,
  trainingFieldKeys,
} from "./taskSubmissionSchema.js";
import { SUITES } from "./suites.js";
import { buildSuiteBadgeList } from "../components/badges.js";



// TODO move out build from controller
const PANEL_ID = "task-panel";

// This component owns its markup: `buildTaskPanel()` goes in the panel, and
// `createTaskSection()` finds it once that markup is in the DOM. Same shape as
// submissionUpload.js.
function buildTaskPanel() {
  return `<div id="${PANEL_ID}"></div>`;
}

function createTaskSection({ taskSuites, onChange } = {}) {
  const container = document.getElementById(PANEL_ID);

  let tasks = new Map();
  let groups = new Map();
  let selectedTaskId = null;
  let model = null;

  // ─── TASK STATE ───────────────────────────────────────────────────────────

  function createTask(taskId) {
    const state = createFieldState(TASK_FIELDS);

    state.task_id = taskId;
    state.model = model;

    return {
      taskId,
      state,
      confirmed: false,
      cleared: [],
      applyToSuite: false,
    };
  }

  function getTask(taskId) {
    return tasks.get(taskId);
  }

  function getSuite(taskId) {
    return taskSuites.get(taskId) ?? null;
  }

  function isComplete(task) {
    return task.confirmed && task.cleared.length === 0;
  }

  // ─── SUITE OPERATIONS ─────────────────────────────────────────────────────

  function getSuiteSiblings(task) {
    const suite = getSuite(task.taskId);

    if (!suite) return [];

    return [...groups.get(suite) ?? []];
  }

  function valuesEqual(a, b) {
    if (Array.isArray(a) && Array.isArray(b)) {
      return (
        a.length === b.length &&
        a.every((value, index) => value === b[index])
      );
    }

    return a === b;
  }

  function copyFields(source, target) {
    const keys = trainingFieldKeys();

    for (const key of keys) {
      const value = source.state[key];

      target.state[key] = Array.isArray(value)
        ? [...value]
        : value;
    }

    // Revalidate after copying the complete state because field predicates can
    // depend on more than one value.
    revalidateFields(target.state, TASK_FIELDS);

    target.cleared = keys.filter(
      key => !valuesEqual(
        source.state[key],
        target.state[key],
      ),
    );

    // A copied confirmation is only valid if copying did not invalidate anything.
    target.confirmed =
      source.confirmed &&
      target.cleared.length === 0;
  }

  function applyToSuite(task) {
    if (!task.applyToSuite) return;

    for (const sibling of getSuiteSiblings(task)) {
      if (sibling === task) continue;

      copyFields(task, sibling);
    }
  }

  // ─── RENDERING ────────────────────────────────────────────────────────────

  function buildTaskStatus(task) {
    if (task.confirmed) {
      return `<span class="task-status ok">✓</span>`;
    }

    return `<span class="task-status pending"></span>`;
  }

  function buildTaskItem(task) {
    const id = escapeHtml(task.taskId);

    const classes = ["task-item", task.taskId === selectedTaskId ? "selected" : ""]
      .filter(Boolean)
      .join(" ");

    return `
      <button
        type="button"
        class="${classes}"
        data-task="${id}"
      >
        ${buildTaskStatus(task)}
        <span class="task-item-label">${id}</span>
      </button>
    `;
  }

  function buildTaskGroup(suite, suiteTasks) {
    const count = suiteTasks.length;

    // A null suite is the no-catalogue case — one unlabelled group, because there is no
    // suite to name.
    const header = suite
      ? `
        <div class="row left gap-sm">
          ${buildSuiteBadgeList([suite])}
          <span class="metadata">
            ${count} task${count === 1 ? "" : "s"}
          </span>
        </div>
      `
      : "";

    return `
      <div class="column gap-xs">
        ${header}

        <div class="column gap-xs">
          ${suiteTasks.map(buildTaskItem).join("")}
        </div>
      </div>
    `;
  }

  // `groups` is keyed by suite and built once per upload; SUITES is what puts it in a
  // stable order. With no catalogue every task lands under `null`.
  function buildTaskGroups() {
    const keys = taskSuites.size ? SUITES : [null];

    return keys
      .filter(suite => groups.get(suite)?.length)
      .map(suite => buildTaskGroup(suite, groups.get(suite)))
      .join("");
  }

  function buildTaskPicker() {
    return `
      <div class="task-picker column gap-md">
        ${buildTaskGroups()}
      </div>
    `;
  }

  function buildClearedNotice(task) {
    if (!task.cleared.length) return "";

    const labels = task.cleared
      .map(key => TASK_FIELDS[key].label)
      .join(", ");

    return `
      <p class="error-msg">
        Cleared (no longer valid): ${escapeHtml(labels)}
      </p>
    `;
  }

  function buildApplyToSuite(task) {
    const siblings = getSuiteSiblings(task);

    // Don't show the control when this is the only task in the suite.
    if (siblings.length < 2) return "";

    const taskId = escapeHtml(task.taskId);
    const suite = escapeHtml(
      getSuite(task.taskId).toUpperCase(),
    );

    return `
      <div class="card row left gap-sm">
        <label class="label" for="task-apply-suite">
          Apply to all ${suite} tasks (${siblings.length})
        </label>

        <input
          class="input-checkbox task-apply-suite"
          id="task-apply-suite"
          type="checkbox"
          data-task="${taskId}"
          ${task.applyToSuite ? "checked" : ""}
        />
      </div>
    `;
  }

  function buildTaskDetail() {
    const task = getTask(selectedTaskId);

    if (!task) {
      return `
        <div class="card">
          <p class="info-msg">
            Select a task to describe how it was run.
          </p>
        </div>
      `;
    }

    const taskId = escapeHtml(task.taskId);

    return `
      <div class="column gap-md">
        <div class="card column gap-md">
          <p class="title muted">${taskId}</p>

          ${buildClearedNotice(task)}

          <div class="column gap-md">
            ${renderFields(
              fieldsForPanel(TASK_FIELDS, 1),
              task.state,
              TASK_FIELDS,
            )}
          </div>

          <div class="row left gap-sm">
            <label class="label" for="task-confirm">
              Confirm this task
            </label>

            <input
              class="input-checkbox task-confirm"
              id="task-confirm"
              type="checkbox"
              data-task="${taskId}"
              ${task.confirmed ? "checked" : ""}
            />
          </div>
        </div>

        ${buildApplyToSuite(task)}
      </div>
    `;
  }

  function render() {
    if (!tasks.size) {
      renderMessage(
        container,
        "No tasks yet — upload a zip on the panel above.",
      );
      return;
    }

    withPreservedFocus(container, () => {
      container.innerHTML = `
        <div class="task-split">
          ${buildTaskPicker()}
          ${buildTaskDetail()}
        </div>
      `;
    });
  }

  // ─── STATE UPDATES ────────────────────────────────────────────────────────

  function updateTask(task, update) {
    update(task);
    applyToSuite(task);
    render();
    onChange?.();
  }

  function selectTask(taskId) {
    if (!tasks.has(taskId)) return;

    selectedTaskId = taskId;
    render();
  }

  function confirmTask(taskId, confirmed) {
    const task = getTask(taskId);

    if (!task) return;

    updateTask(task, currentTask => {
      currentTask.confirmed = confirmed;
    });
  }

  function updateField(taskId, key, value) {
    const task = getTask(taskId);

    if (!task) return;

    updateTask(task, currentTask => {
      // Editing methodology invalidates the previous confirmation.
      currentTask.confirmed = false;

      currentTask.cleared = setFieldValue(
        currentTask.state,
        TASK_FIELDS,
        key,
        value,
      );
    });
  }

  function toggleApplyToSuite(taskId, checked) {
    const task = getTask(taskId);

    if (!task) return;

    updateTask(task, currentTask => {
      currentTask.applyToSuite = checked;
    });
  }

  // ─── EVENTS ───────────────────────────────────────────────────────────────

  function handleClick(event) {
    const item = event.target.closest(".task-item");

    if (item) {
      selectTask(item.dataset.task);
    }
  }

  function handleChange(event) {
    const confirmCheckbox = event.target.closest(".task-confirm");

    if (confirmCheckbox) {
      confirmTask(
        confirmCheckbox.dataset.task,
        confirmCheckbox.checked,
      );
      return;
    }

    const applyCheckbox = event.target.closest(
      ".task-apply-suite",
    );

    if (applyCheckbox) {
      toggleApplyToSuite(
        applyCheckbox.dataset.task,
        applyCheckbox.checked,
      );
      return;
    }

    const input = event.target.closest("[data-field]");

    if (!input || !selectedTaskId) return;

    const key = input.dataset.field;
    const field = TASK_FIELDS[key];

    if (!field) return;

    updateField(
      selectedTaskId,
      key,
      getFieldValue(
        field,
        key,
        input,
        container,
      ),
    );
  }

  function attach() {
    container.addEventListener("click", handleClick);
    container.addEventListener("change", handleChange);

    // Draws the "no tasks yet" placeholder; without it the panel is blank until a zip
    // lands, which the old `initialise()` avoided by rendering here.
    render();
  }

  // ─── PUBLIC API ───────────────────────────────────────────────────────────

  function setTasks(taskIds) {
    tasks = new Map(
      taskIds.map(taskId => [
        taskId,
        createTask(taskId),
      ]),
    );

    // Assign the tasks to groups
    groups = new Map()
    for (const task of tasks.values()) {
      const suite = getSuite(task.taskId);

      if (!groups.has(suite)) {
        groups.set(suite, []);
      }

      groups.get(suite).push(task);
    }

    selectedTaskId = taskIds[0] ?? null;

    render();
    onChange?.();
  }

  function setModel(newModel) {
    model = newModel;

    for (const task of tasks.values()) {
      task.state.model = model;

      task.cleared = setFieldValue(
        task.state,
        TASK_FIELDS,
        "model",
        model,
      );

      task.confirmed = false;
    }

    render();
    onChange?.();
  }

  function allConfirmed() {
    return (
      tasks.size > 0 &&
      [...tasks.values()].every(isComplete)
    );
  }

  // TODO move this out?
  function payloads() {
    const keys = trainingFieldKeys();

    return [...tasks.values()].map(task => ({
      task_id: task.taskId,
      ...Object.fromEntries(
        keys.map(key => [
          key,
          task.state[key],
        ]),
      ),
    }));
  }


  return {
    attach,
    setTasks,
    setModel,
    allConfirmed,
    payloads,
  };
}

export { buildTaskPanel, createTaskSection };