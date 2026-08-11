// The task panel of the single-page submission form (js/submissions/submissionCreate.js).
//
// Master–detail: detected tasks are listed on the left, grouped by suite, and the
// selected task's methodology form is shown on the right.
//
// The task list is determined entirely by the uploaded zip. This section does not
// add, remove, or rename tasks.
//
// Usage:
//
//   const tasks = createTaskSection({ container, onChange });
//   await tasks.initialise(catalogue);
//   tasks.setModel(model);
//   tasks.applyDetected(idsFromZip);

import { escapeHtml, renderMessage } from "../utils.js";
import {
  createFieldState,
  fieldsForPanel,
  getFieldValue,
  renderFields,
  revalidateFields,
  setFieldValue,
} from "../utils/form-fields.js";
import {
  TASK_FIELDS,
  loadTaskFields,
  trainingFieldKeys,
} from "./taskSubmissionSchema.js";
import { SUITES } from "../utils/suites.js";
import { buildSuiteBadgeList } from "../components/badges.js"

/**
 * @param {HTMLElement} container
 * @param {() => void} [onChange]
 * @returns {{
 *   initialise: (catalogue: Map) => Promise<void>,
 *   applyDetected: (taskIds: string[]) => void,
 *   setModel: (model: object) => void,
 *   allValid: () => boolean,
 *   allConfirmed: () => boolean,
 *   ids: () => string[],
 *   payloads: () => object[],
 * }}
 */
function createTaskSection({ container, onChange } = {}) {
  // Tasks are kept in upload order. The Map provides O(1) lookup by task ID.
  let tasks = new Map();

  // task ID → suite name.
  // An empty map means the catalogue could not be loaded, so task IDs are
  // treated as valid rather than marking every task as unknown.
  let taskSuites = new Map();

  let selectedTaskId = null;
  let model = null;

  // ─── STATE ──────────────────────────────────────────────────────────────

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

  function isValid(taskId) {
    return taskSuites.size === 0 || taskSuites.has(taskId);
  }

  function getSuite(taskId) {
    return taskSuites.get(taskId) ?? null;
  }

  // ─── GROUPING ────────────────────────────────────────────────────────────

  function groupTasks() {
    if (tasks.size === 0) return [];

    // If the catalogue is unavailable, don't pretend we know which tasks
    // belong to which suite.
    if (taskSuites.size === 0) {
      return [
        {
          key: "all",
          badge: "",
          tasks: [...tasks.values()],
        },
      ];
    }

    const groups = new Map();

    for (const task of tasks.values()) {
      const suite = getSuite(task.taskId);
      const key = suite ?? "unknown";

      if (!groups.has(key)) {
        groups.set(key, []);
      }

      groups.get(key).push(task);
    }

    // Unknown tasks deliberately appear first so they cannot be overlooked.
    const result = [];

    if (groups.has("unknown")) {
      result.push({
        key: "unknown",
        badge: `<span class="badge sm error">Unrecognised</span>`,
        tasks: groups.get("unknown"),
      });
    }

    for (const suite of SUITES) {
      const suiteTasks = groups.get(suite);

      if (!suiteTasks?.length) continue;

      result.push({
        key: suite,
        badge: buildSuiteBadgeList([suite]),
        tasks: suiteTasks,
      });
    }

    return result;
  }

  // ─── APPLY TO SUITE ─────────────────────────────────────────────────────

  function suiteSiblings(task) {
    const suite = getSuite(task.taskId);

    if (suite === null) return [];

    return [...tasks.values()].filter(
      other => getSuite(other.taskId) === suite,
    );
  }

  function sameValue(a, b) {
    if (Array.isArray(a) && Array.isArray(b)) {
      return (
        a.length === b.length &&
        a.every((value, index) => value === b[index])
      );
    }

    return a === b;
  }

  /**
   * Copy all methodology fields from one task to another.
   *
   * The whole state is assigned before revalidation. This matters because
   * schema predicates can depend on multiple fields.
   */
  function copyMethodology(source, target) {
    for (const key of trainingFieldKeys()) {
      const value = source.state[key];

      target.state[key] = Array.isArray(value) ? [...value] : value;
    }

    revalidateFields(target.state, TASK_FIELDS);

    target.cleared = trainingFieldKeys().filter(
      key => !sameValue(source.state[key], target.state[key]),
    );

    // Confirmation belongs to the methodology being copied. However, never
    // propagate a confirmation if copying caused values to become invalid.
    target.confirmed =
      source.confirmed && target.cleared.length === 0;
  }

  function propagate(task) {
    if (!task.applyToSuite) return;

    for (const sibling of suiteSiblings(task)) {
      if (sibling !== task) {
        copyMethodology(task, sibling);
      }
    }
  }

  // ─── RENDERING ──────────────────────────────────────────────────────────

  function buildStatus(task) {
    if (!isValid(task.taskId)) {
      return `<span class="task-status bad">✗</span>`;
    }

    if (task.confirmed) {
      return `<span class="task-status ok">✓</span>`;
    }

    return `<span class="task-status pending"></span>`;
  }

  function buildItem(task) {
    const id = escapeHtml(task.taskId);

    const classes = [
      "task-item",
      task.taskId === selectedTaskId ? "selected" : "",
      isValid(task.taskId) ? "" : "invalid",
    ]
      .filter(Boolean)
      .join(" ");

    return `
      <button
        type="button"
        class="${classes}"
        data-task="${id}"
      >
        ${buildStatus(task)}
        <span class="task-item-label">${id}</span>
      </button>
    `;
  }

  function buildGroup(group) {
    const count = group.tasks.length;

    const header = group.badge
      ? `
        <div class="row left gap-sm">
          ${group.badge}
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
          ${group.tasks.map(buildItem).join("")}
        </div>
      </div>
    `;
  }

  function buildPicker() {
    return `
      <div class="task-picker column gap-md">
        ${groupTasks().map(buildGroup).join("")}
      </div>
    `;
  }

  function buildClearedNotice(task) {
    if (task.cleared.length === 0) return "";

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
    const siblings = suiteSiblings(task);

    // No point offering "apply to all" when this is the only task in the suite.
    if (siblings.length < 2) return "";

    const id = escapeHtml(task.taskId);
    const suite = escapeHtml(getSuite(task.taskId).toUpperCase());

    return `
      <div class="card row left gap-sm">
        <label class="label" for="task-apply-suite">
          Apply to all ${suite} tasks (${siblings.length})
        </label>

        <input
          class="input-checkbox task-apply-suite"
          id="task-apply-suite"
          type="checkbox"
          data-task="${id}"
          ${task.applyToSuite ? "checked" : ""}
        />
      </div>
    `;
  }

  function buildDetail() {
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

    const id = escapeHtml(task.taskId);

    if (!isValid(task.taskId)) {
      return `
        <div class="card column gap-md">
          <p class="title muted">${id}</p>

          <p class="error-msg">
            ✗ "${id}" is not a recognised task.
            Correct the folder name in your zip and upload it again.
          </p>
        </div>
      `;
    }

    return `
      <div class="column gap-md">
        <div class="card column gap-md">
          <p class="title muted">${id}</p>

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
              data-task="${id}"
              ${task.confirmed ? "checked" : ""}
            />
          </div>
        </div>

        ${buildApplyToSuite(task)}
      </div>
    `;
  }

  function render() {
    if (tasks.size === 0) {
      renderMessage(
        container,
        "No tasks yet — upload a zip on the panel above.",
      );
      return;
    }

    container.innerHTML = `
      <div class="task-split">
        ${buildPicker()}
        ${buildDetail()}
      </div>
    `;
  }

  // ─── EVENTS ─────────────────────────────────────────────────────────────

  function updateTask(task, update) {
    update(task);

    propagate(task);
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

    updateTask(task, task => {
      task.confirmed = confirmed;
    });
  }

  function setTaskField(taskId, key, value) {
    const task = getTask(taskId);

    if (!task) return;

    updateTask(task, task => {
      // Confirmation means "the current values are correct", so any edit
      // invalidates it.
      task.confirmed = false;

      task.cleared = setFieldValue(
        task.state,
        TASK_FIELDS,
        key,
        value,
      );
    });
  }

  function setApplyToSuite(taskId, checked) {
    const task = getTask(taskId);

    if (!task) return;

    updateTask(task, task => {
      task.applyToSuite = checked;
    });
  }

  function attachEvents() {
    container.addEventListener("click", event => {
      const item = event.target.closest(".task-item");

      if (item) {
        selectTask(item.dataset.task);
      }
    });

    container.addEventListener("change", event => {
      const confirmCheckbox = event.target.closest(".task-confirm");

      if (confirmCheckbox) {
        confirmTask(
          confirmCheckbox.dataset.task,
          confirmCheckbox.checked,
        );
        return;
      }

      const applyCheckbox = event.target.closest(".task-apply-suite");

      if (applyCheckbox) {
        setApplyToSuite(
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

      setTaskField(
        selectedTaskId,
        key,
        getFieldValue(field, key, input, container),
      );
    });
  }

  // ─── PAGE INTERFACE ─────────────────────────────────────────────────────

  function applyDetected(detectedTaskIds) {
    tasks = new Map(
      detectedTaskIds.map(taskId => [
        taskId,
        createTask(taskId),
      ]),
    );

    // Put the first invalid task first, otherwise select the first task.
    selectedTaskId =
      detectedTaskIds.find(id => !isValid(id)) ??
      detectedTaskIds[0] ??
      null;

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

  function allValid() {
    return [...tasks.values()].every(task =>
      isValid(task.taskId),
    );
  }

  function allConfirmed() {
    return (
      tasks.size > 0 &&
      [...tasks.values()].every(task => task.confirmed)
    );
  }

  function ids() {
    return [...tasks.keys()];
  }

  function payloads() {
    return [...tasks.values()].map(task => ({
      task_id: task.taskId,
      ...Object.fromEntries(
        trainingFieldKeys().map(key => [
          key,
          task.state[key],
        ]),
      ),
    }));
  }

  async function initialise(knownTasks) {
    taskSuites = knownTasks ?? new Map();

    await loadTaskFields();

    attachEvents();
    render();
  }

  return {
    initialise,
    applyDetected,
    setModel,
    allValid,
    allConfirmed,
    ids,
    payloads,
  };
}

export { createTaskSection };